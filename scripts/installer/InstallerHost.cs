using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PointBenchInstaller
{
    internal sealed class PackageFile
    {
        public string RelativePath;
        public long Length;
        public string Sha256;
    }

    internal sealed class PackageManifest
    {
        public string Type;
        public string Product;
        public string Version;
        public string RequiredDependenciesVersion;
        public string Platform;
        public long PayloadStart;
        public byte[] RawManifest;
        public readonly List<PackageFile> Files = new List<PackageFile>();
    }

    internal sealed class ProgressWindow : Form
    {
        private readonly Label _phase;
        private readonly Label _detail;
        private readonly ProgressBar _bar;

        public ProgressWindow(string title)
        {
            Text = title;
            Width = 600;
            Height = 180;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;
            ShowInTaskbar = true;
            TopMost = true;

            _phase = new Label();
            _phase.Left = 24;
            _phase.Top = 20;
            _phase.Width = 540;
            _phase.Height = 24;
            _phase.Font = new System.Drawing.Font(System.Drawing.SystemFonts.MessageBoxFont, System.Drawing.FontStyle.Bold);

            _bar = new ProgressBar();
            _bar.Left = 24;
            _bar.Top = 54;
            _bar.Width = 540;
            _bar.Height = 24;

            _detail = new Label();
            _detail.Left = 24;
            _detail.Top = 90;
            _detail.Width = 540;
            _detail.Height = 38;
            _detail.AutoEllipsis = true;

            Controls.Add(_phase);
            Controls.Add(_bar);
            Controls.Add(_detail);
        }

        public void SetProgress(string phase, int completed, int total, string detail)
        {
            _phase.Text = phase;
            _detail.Text = detail ?? String.Empty;
            if (total <= 0)
            {
                _bar.Style = ProgressBarStyle.Marquee;
                _bar.MarqueeAnimationSpeed = 25;
            }
            else
            {
                _bar.Style = ProgressBarStyle.Continuous;
                _bar.MarqueeAnimationSpeed = 0;
                _bar.Minimum = 0;
                _bar.Maximum = Math.Max(1, total);
                _bar.Value = Math.Max(0, Math.Min(completed, total));
                int percent = (int)((long)Math.Max(0, completed) * 100L / Math.Max(1, total));
                _phase.Text = phase + "  " + percent.ToString(CultureInfo.InvariantCulture) + "%";
            }
            Refresh();
            Application.DoEvents();
        }
    }

    internal static class Program
    {
        private const string DefaultRegistryPath = @"Software\PointBench";
        private const string PackageMagic = "PBPKG001";
        private static bool _silent;
        private static bool _noDesktop;
        private static string _registryPath = DefaultRegistryPath;
        private static string _logPath;
        private static ProgressWindow _progress;

        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            _silent = HasArgument(args, "/S") || HasArgument(args, "--silent");
            _noDesktop = HasArgument(args, "/NODESKTOP");
            string requestedRegistryPath = ArgumentValue(args, "/REGKEY=");
            if (!String.IsNullOrWhiteSpace(requestedRegistryPath)) _registryPath = requestedRegistryPath;
            string requestedDirectory = ArgumentValue(args, "/D=");
            string logDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PointBench", "install-logs");
            Directory.CreateDirectory(logDirectory);
            _logPath = Path.Combine(logDirectory, DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-installer.log");

            try
            {
                PackageManifest package = ReadPackage(Application.ExecutablePath);
                Log("Package type={0}; version={1}; files={2}", package.Type, package.Version, package.Files.Count);
                if (!String.Equals(package.Platform, "windows-x64", StringComparison.OrdinalIgnoreCase) || !Environment.Is64BitOperatingSystem)
                    throw new InvalidOperationException("该安装包仅支持 64 位 Windows。 ");

                if (String.Equals(package.Type, "dependencies", StringComparison.OrdinalIgnoreCase))
                    return InstallDependencies(package, requestedDirectory);
                if (String.Equals(package.Type, "code", StringComparison.OrdinalIgnoreCase))
                    return InstallCode(package);
                throw new InvalidDataException("未知安装包类型：" + package.Type);
            }
            catch (Exception ex)
            {
                CloseProgress();
                Log("ERROR: {0}\r\n{1}", ex.Message, ex.StackTrace);
                Show("安装失败：\r\n\r\n" + ex.Message + "\r\n\r\n日志：" + _logPath, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static int InstallDependencies(PackageManifest package, string requestedDirectory)
        {
            string defaultDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PointBench", "Dependencies", package.Version);
            string previousDirectory = null;
            string previousCodeDirectory = null;
            using (RegistryKey existingKey = Registry.CurrentUser.OpenSubKey(_registryPath))
            {
                previousDirectory = existingKey == null ? null : existingKey.GetValue("DependenciesInstallDir") as string;
                previousCodeDirectory = existingKey == null ? null : existingKey.GetValue("CodeInstallDir") as string;
                if (!String.IsNullOrWhiteSpace(previousDirectory))
                {
                    defaultDirectory = Path.GetFullPath(previousDirectory);
                    Log("Reusing previous dependency install directory: {0}", defaultDirectory);
                }
            }
            string target = ChooseInstallDirectory("选择 PointBench 依赖安装目录", requestedDirectory, defaultDirectory);
            if (target == null) return 3;

            StartProgress("PointBench 依赖安装", "正在准备安装", 0, 0, target);
            if (!String.IsNullOrWhiteSpace(previousCodeDirectory) && !PathsEqual(previousCodeDirectory, target))
                StopRunningPointBench(previousCodeDirectory);
            if (!String.IsNullOrWhiteSpace(previousDirectory) && !PathsEqual(previousDirectory, target) && !PathsEqual(previousDirectory, previousCodeDirectory))
                StopRunningPointBench(previousDirectory);
            StopRunningPointBench(target);
            ExtractAndVerify(package, target);
            UpdateProgress("正在记录依赖版本", 1, 1, package.Version, true);
            string marker = Path.Combine(target, ".pointbench-dependencies");
            File.WriteAllText(marker, "version=" + package.Version + Environment.NewLine + "installedAt=" + DateTime.Now.ToString("o", CultureInfo.InvariantCulture), new UTF8Encoding(false));
            File.WriteAllBytes(Path.Combine(target, ".pointbench-dependencies.manifest"), package.RawManifest);

            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(_registryPath))
            {
                key.SetValue("DependenciesInstallDir", target, RegistryValueKind.String);
                key.SetValue("DependenciesVersion", package.Version, RegistryValueKind.String);
                key.SetValue("DependenciesInstalledAt", DateTime.Now.ToString("o", CultureInfo.InvariantCulture), RegistryValueKind.String);
                key.SetValue("DependenciesManifestSha256", Sha256(package.RawManifest), RegistryValueKind.String);
            }
            CloseProgress();
            Show("PointBench 依赖安装并校核完成。\r\n\r\n版本：" + package.Version + "\r\n位置：" + target, MessageBoxIcon.Information);
            return 0;
        }

        private static int InstallCode(PackageManifest package)
        {
            string dependencyDirectory;
            string dependencyVersion;
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(_registryPath))
            {
                dependencyDirectory = key == null ? null : key.GetValue("DependenciesInstallDir") as string;
                dependencyVersion = key == null ? null : key.GetValue("DependenciesVersion") as string;
            }

            if (String.IsNullOrWhiteSpace(dependencyDirectory) || String.IsNullOrWhiteSpace(dependencyVersion))
                throw new InvalidOperationException("未检测到 PointBench 依赖安装记录。请先运行依赖安装 EXE。 ");
            if (!String.Equals(dependencyVersion, package.RequiredDependenciesVersion, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("依赖版本不匹配。代码要求 " + package.RequiredDependenciesVersion + "，当前记录为 " + dependencyVersion + "。请先安装匹配的依赖版本。 ");
            string target = Path.GetFullPath(dependencyDirectory);
            Log("Code install directory follows dependency installation: {0}", target);

            StartProgress("PointBench 代码安装", "正在检查后台运行状态", 0, 0, dependencyDirectory);
            StopRunningPointBench(target);
            UpdateProgress("正在读取依赖安装清单", 0, 0, dependencyDirectory, true);
            VerifyDependencyInstallation(dependencyDirectory, dependencyVersion);
            UpdateProgress("正在安装代码文件", 0, package.Files.Count, target, true);
            ExtractAndVerify(package, target);

            UpdateProgress("正在配置共享依赖", 0, 0, dependencyDirectory, true);
            string nodeModulesTarget = Path.Combine(dependencyDirectory, "frontend", "node_modules");
            string nodeModulesLink = Path.Combine(target, "frontend", "node_modules");
            CreateDirectoryJunction(nodeModulesLink, nodeModulesTarget);

            string dataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PointBench", "Data");
            Directory.CreateDirectory(dataDirectory);
            Directory.CreateDirectory(Path.Combine(dataDirectory, "storage"));
            Directory.CreateDirectory(Path.Combine(dataDirectory, "logs"));

            UpdateProgress("正在创建桌面快捷方式", 0, 0, target, true);
            string shortcutPath = _noDesktop ? String.Empty : CreateDesktopShortcut(target);
            File.WriteAllText(
                Path.Combine(target, "config", "install-state.txt"),
                "codeVersion=" + package.Version + Environment.NewLine +
                "dependenciesVersion=" + dependencyVersion + Environment.NewLine +
                "dependenciesInstallDir=" + dependencyDirectory + Environment.NewLine +
                "userDataDir=" + dataDirectory + Environment.NewLine,
                new UTF8Encoding(false));

            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(_registryPath))
            {
                key.SetValue("CodeInstallDir", target, RegistryValueKind.String);
                key.SetValue("CodeVersion", package.Version, RegistryValueKind.String);
                key.SetValue("CodeDependenciesVersion", dependencyVersion, RegistryValueKind.String);
                key.SetValue("CodeInstalledAt", DateTime.Now.ToString("o", CultureInfo.InvariantCulture), RegistryValueKind.String);
                key.SetValue("CodeManifestSha256", Sha256(package.RawManifest), RegistryValueKind.String);
                key.SetValue("UserDataDir", dataDirectory, RegistryValueKind.String);
                key.SetValue("DesktopShortcut", shortcutPath, RegistryValueKind.String);
            }
            UpdateProgress("安装完成", 1, 1, target, true);
            CloseProgress();
            Show("PointBench 代码安装并校核完成。\r\n\r\n代码版本：" + package.Version + "\r\n依赖版本：" + dependencyVersion + "\r\n位置：" + target + "\r\n\r\n桌面快捷方式已创建。", MessageBoxIcon.Information);
            return 0;
        }

        private static bool PathsEqual(string left, string right)
        {
            if (String.IsNullOrWhiteSpace(left) || String.IsNullOrWhiteSpace(right)) return false;
            return String.Equals(
                Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }

        private static void StopRunningPointBench(string installDirectory)
        {
            string target = Path.GetFullPath(installDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            List<int> running = FindPointBenchProcesses(target);
            if (running.Count == 0)
            {
                Log("No running PointBench processes found for {0}", target);
                return;
            }

            UpdateProgress("正在关闭运行中的 PointBench", 0, 0, "正在请求后台程序安全退出", true);
            Log("PointBench is running. Process IDs: {0}", String.Join(",", running));
            try
            {
                using (EventWaitHandle shutdown = EventWaitHandle.OpenExisting(@"Local\PointBenchShutdown"))
                {
                    shutdown.Set();
                    Log("Sent PointBench graceful shutdown signal.");
                }
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                Log("The installed launcher does not expose a shutdown signal; compatibility shutdown will be used.");
            }

            if (WaitForPointBenchExit(target, 5000)) return;

            running = FindPointBenchProcesses(target);
            UpdateProgress("正在关闭运行中的 PointBench", 0, 0, "正在结束旧版后台进程", true);
            foreach (int processId in running) KillProcessTree(processId);

            if (!WaitForPointBenchExit(target, 10000))
            {
                running = FindPointBenchProcesses(target);
                throw new IOException("无法关闭正在运行的 PointBench。请从托盘退出后重试。进程 ID：" + String.Join(",", running));
            }
            Log("Running PointBench instance stopped before installation.");
        }

        private static bool WaitForPointBenchExit(string target, int timeoutMilliseconds)
        {
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < timeoutMilliseconds)
            {
                if (FindPointBenchProcesses(target).Count == 0) return true;
                Application.DoEvents();
                Thread.Sleep(250);
            }
            return FindPointBenchProcesses(target).Count == 0;
        }

        private static List<int> FindPointBenchProcesses(string target)
        {
            List<int> result = new List<int>();
            string runtimePrefix = Path.Combine(target, "runtime") + Path.DirectorySeparatorChar;
            string launcherPath = Path.Combine(target, "scripts", "launcher.ps1");
            int currentProcessId = Process.GetCurrentProcess().Id;

            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process"))
                using (ManagementObjectCollection processes = searcher.Get())
                {
                    foreach (ManagementObject process in processes)
                    {
                        int processId = Convert.ToInt32((uint)process["ProcessId"], CultureInfo.InvariantCulture);
                        if (processId == currentProcessId) continue;
                        string executable = process["ExecutablePath"] as string ?? String.Empty;
                        string commandLine = process["CommandLine"] as string ?? String.Empty;
                        bool runtimeProcess = executable.StartsWith(runtimePrefix, StringComparison.OrdinalIgnoreCase);
                        string processName = Path.GetFileName(executable);
                        bool launcherProcess =
                            (String.Equals(processName, "powershell.exe", StringComparison.OrdinalIgnoreCase) ||
                             String.Equals(processName, "pwsh.exe", StringComparison.OrdinalIgnoreCase)) &&
                            HasPowerShellFileArgument(commandLine, launcherPath);
                        if ((runtimeProcess || launcherProcess) && !result.Contains(processId)) result.Add(processId);
                    }
                }
            }
            catch (Exception ex)
            {
                Log("Process detection warning: {0}", ex.Message);
            }
            return result;
        }

        private static bool HasPowerShellFileArgument(string commandLine, string launcherPath)
        {
            int fileIndex = commandLine.IndexOf("-File", StringComparison.OrdinalIgnoreCase);
            if (fileIndex < 0) return false;
            string value = commandLine.Substring(fileIndex + 5).TrimStart();
            string quotedPath = "\"" + launcherPath + "\"";
            if (value.StartsWith(quotedPath, StringComparison.OrdinalIgnoreCase)) return true;
            return value.StartsWith(launcherPath, StringComparison.OrdinalIgnoreCase) &&
                (value.Length == launcherPath.Length || Char.IsWhiteSpace(value[launcherPath.Length]));
        }

        private static void KillProcessTree(int processId)
        {
            try
            {
                ProcessStartInfo start = new ProcessStartInfo("taskkill.exe", "/PID " + processId.ToString(CultureInfo.InvariantCulture) + " /T /F");
                start.CreateNoWindow = true;
                start.UseShellExecute = false;
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                using (Process process = Process.Start(start))
                {
                    string detail = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    Log("taskkill PID={0}; exit={1}; detail={2}", processId, process.ExitCode, detail.Trim());
                }
            }
            catch (Exception ex)
            {
                Log("Failed to stop process tree PID={0}: {1}", processId, ex.Message);
            }
        }

        private static void VerifyDependencyInstallation(string directory, string version)
        {
            if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("依赖安装目录不存在：" + directory);
            string marker = Path.Combine(directory, ".pointbench-dependencies");
            string manifestPath = Path.Combine(directory, ".pointbench-dependencies.manifest");
            string python = Path.Combine(directory, "runtime", "python", "python.exe");
            string node = Path.Combine(directory, "runtime", "node", "node.exe");
            string vite = Path.Combine(directory, "frontend", "node_modules", "vite", "bin", "vite.js");
            if (!File.Exists(marker) || !File.Exists(manifestPath) || File.ReadAllText(marker).IndexOf("version=" + version, StringComparison.OrdinalIgnoreCase) < 0)
                throw new InvalidDataException("依赖安装标记缺失或版本不一致，请重新运行依赖安装 EXE。 ");
            if (!File.Exists(python) || !File.Exists(node) || !File.Exists(vite))
                throw new InvalidDataException("依赖安装不完整（Python、Node.js 或 Vite 缺失），请重新运行依赖安装 EXE。 ");
            PackageManifest installed = ParseManifest(File.ReadAllBytes(manifestPath));
            if (!String.Equals(installed.Version, version, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("依赖安装清单版本不一致，请重新运行依赖安装 EXE。 ");
            int checkedFiles = 0;
            int skippedMutableFiles = 0;
            foreach (PackageFile item in installed.Files)
            {
                if (IsMutableDependencyFile(item.RelativePath))
                {
                    skippedMutableFiles++;
                    continue;
                }
                string path = Path.Combine(directory, item.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                FileInfo info = new FileInfo(path);
                if (!info.Exists || info.Length != item.Length || !String.Equals(Sha256File(path), item.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("依赖文件校核失败，请重新安装依赖：" + item.RelativePath);
                checkedFiles++;
                UpdateProgress("正在校核依赖文件", checkedFiles, installed.Files.Count, item.RelativePath, false);
            }
            if (skippedMutableFiles > 0) Log("Skipped {0} mutable dependency cache files during verification.", skippedMutableFiles);
        }

        private static bool IsMutableDependencyFile(string relativePath)
        {
            string normalized = (relativePath ?? String.Empty).Replace('\\', '/');
            return normalized.StartsWith("frontend/node_modules/.vite/", StringComparison.OrdinalIgnoreCase) ||
                normalized.IndexOf("/__pycache__/", StringComparison.OrdinalIgnoreCase) >= 0 ||
                normalized.EndsWith(".pyc", StringComparison.OrdinalIgnoreCase) ||
                normalized.EndsWith(".pyo", StringComparison.OrdinalIgnoreCase);
        }

        private static string ChooseInstallDirectory(string description, string requested, string defaultDirectory)
        {
            if (!String.IsNullOrWhiteSpace(requested)) return Path.GetFullPath(Environment.ExpandEnvironmentVariables(requested.Trim('"')));
            if (_silent) return defaultDirectory;
            Directory.CreateDirectory(defaultDirectory);
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = description + "（无需管理员权限）";
                dialog.SelectedPath = defaultDirectory;
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog() != DialogResult.OK) return null;
                return Path.GetFullPath(dialog.SelectedPath);
            }
        }

        private static void ExtractAndVerify(PackageManifest package, string target)
        {
            target = Path.GetFullPath(target);
            Directory.CreateDirectory(target);
            string targetPrefix = target.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            using (FileStream input = File.OpenRead(Application.ExecutablePath))
            {
                input.Position = package.PayloadStart;
                byte[] buffer = new byte[1024 * 1024];
                int installedFiles = 0;
                foreach (PackageFile item in package.Files)
                {
                    string relative = item.RelativePath.Replace('/', Path.DirectorySeparatorChar);
                    string destination = Path.GetFullPath(Path.Combine(target, relative));
                    if (!destination.StartsWith(targetPrefix, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("安装包包含不安全路径：" + item.RelativePath);
                    string parent = Path.GetDirectoryName(destination);
                    if (!String.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    string temporary = destination + ".pointbench-installing";
                    using (SHA256 hasher = SHA256.Create())
                    using (FileStream output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        long remaining = item.Length;
                        while (remaining > 0)
                        {
                            int wanted = (int)Math.Min(buffer.Length, remaining);
                            int read = input.Read(buffer, 0, wanted);
                            if (read <= 0) throw new EndOfStreamException("安装包数据提前结束：" + item.RelativePath);
                            output.Write(buffer, 0, read);
                            hasher.TransformBlock(buffer, 0, read, null, 0);
                            remaining -= read;
                        }
                        hasher.TransformFinalBlock(new byte[0], 0, 0);
                        string actual = Hex(hasher.Hash);
                        if (!String.Equals(actual, item.Sha256, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("文件校验失败：" + item.RelativePath);
                    }
                    if (File.Exists(destination)) File.Delete(destination);
                    File.Move(temporary, destination);
                    installedFiles++;
                    UpdateProgress("正在写入并校核文件", installedFiles, package.Files.Count, item.RelativePath, false);
                }
            }

            foreach (PackageFile item in package.Files)
            {
                string destination = Path.Combine(target, item.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                FileInfo info = new FileInfo(destination);
                if (!info.Exists || info.Length != item.Length)
                    throw new InvalidDataException("安装后文件校核失败：" + item.RelativePath);
            }
        }

        private static PackageManifest ReadPackage(string executable)
        {
            using (FileStream stream = File.OpenRead(executable))
            {
                if (stream.Length < 16) throw new InvalidDataException("安装包不完整。 ");
                stream.Position = stream.Length - 16;
                byte[] lengthBytes = ReadExactly(stream, 8);
                byte[] magicBytes = ReadExactly(stream, 8);
                if (Encoding.ASCII.GetString(magicBytes) != PackageMagic) throw new InvalidDataException("没有找到 PointBench 安装载荷。 ");
                long manifestLength = BitConverter.ToInt64(lengthBytes, 0);
                if (manifestLength <= 0 || manifestLength > stream.Length - 16) throw new InvalidDataException("安装清单长度无效。 ");
                stream.Position = stream.Length - 16 - manifestLength;
                byte[] manifestBytes = ReadExactly(stream, checked((int)manifestLength));
                PackageManifest manifest = ParseManifest(manifestBytes);
                long payloadLength = 0;
                foreach (PackageFile file in manifest.Files) payloadLength += file.Length;
                manifest.PayloadStart = stream.Length - 16 - manifestLength - payloadLength;
                manifest.RawManifest = manifestBytes;
                if (manifest.PayloadStart <= 0) throw new InvalidDataException("安装载荷位置无效。 ");
                return manifest;
            }
        }

        private static PackageManifest ParseManifest(byte[] bytes)
        {
            PackageManifest manifest = new PackageManifest();
            string[] lines = Encoding.UTF8.GetString(bytes).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string raw in lines)
            {
                string line = raw.TrimEnd('\r');
                string[] parts = line.Split('\t');
                if (parts.Length == 2 && parts[0] != "F")
                {
                    if (parts[0] == "Type") manifest.Type = parts[1];
                    else if (parts[0] == "Product") manifest.Product = parts[1];
                    else if (parts[0] == "Version") manifest.Version = parts[1];
                    else if (parts[0] == "RequiredDependenciesVersion") manifest.RequiredDependenciesVersion = parts[1];
                    else if (parts[0] == "Platform") manifest.Platform = parts[1];
                }
                else if (parts.Length == 4 && parts[0] == "F")
                {
                    PackageFile file = new PackageFile();
                    file.Length = Int64.Parse(parts[1], CultureInfo.InvariantCulture);
                    file.Sha256 = parts[2];
                    file.RelativePath = Encoding.UTF8.GetString(Convert.FromBase64String(parts[3]));
                    manifest.Files.Add(file);
                }
            }
            if (String.IsNullOrWhiteSpace(manifest.Type) || String.IsNullOrWhiteSpace(manifest.Version) || manifest.Files.Count == 0)
                throw new InvalidDataException("安装清单缺少必要字段。 ");
            return manifest;
        }

        private static void CreateDirectoryJunction(string link, string target)
        {
            if (!Directory.Exists(target)) throw new DirectoryNotFoundException("依赖目录不存在：" + target);
            string normalizedLink = Path.GetFullPath(link).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalizedTarget = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (String.Equals(normalizedLink, normalizedTarget, StringComparison.OrdinalIgnoreCase))
            {
                Log("Code and dependencies share node_modules: {0}", normalizedTarget);
                return;
            }
            if (Directory.Exists(link))
            {
                FileAttributes attributes = File.GetAttributes(link);
                if ((attributes & FileAttributes.ReparsePoint) != 0) Directory.Delete(link, false);
                else if (Directory.GetFileSystemEntries(link).Length == 0) Directory.Delete(link, false);
                else throw new IOException("代码目录中已存在非空 node_modules，无法连接共享依赖：" + link);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(link));
            ProcessStartInfo start = new ProcessStartInfo("cmd.exe", "/d /c mklink /J \"" + link + "\" \"" + target + "\"");
            start.CreateNoWindow = true;
            start.UseShellExecute = false;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
                string detail = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                if (process.ExitCode != 0 || !Directory.Exists(link)) throw new IOException("创建共享依赖目录连接失败：" + detail);
            }
        }

        private static string CreateDesktopShortcut(string codeDirectory)
        {
            string shortcutPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PointBench.lnk");
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new InvalidOperationException("系统不支持创建桌面快捷方式。 ");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(Environment.SystemDirectory, "wscript.exe") });
            shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { "\"" + Path.Combine(codeDirectory, "scripts", "run.vbs") + "\"" });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { codeDirectory });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(codeDirectory, "assets", "PointBench.ico") + ",0" });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "PointBench 离线试验测点工作台" });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            return shortcutPath;
        }

        private static bool HasArgument(string[] args, string expected)
        {
            foreach (string arg in args) if (String.Equals(arg, expected, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static string ArgumentValue(string[] args, string prefix)
        {
            foreach (string arg in args) if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return arg.Substring(prefix.Length);
            return null;
        }

        private static byte[] ReadExactly(Stream stream, int count)
        {
            byte[] result = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = stream.Read(result, offset, count - offset);
                if (read <= 0) throw new EndOfStreamException();
                offset += read;
            }
            return result;
        }

        private static string Sha256(byte[] value)
        {
            using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(value));
        }

        private static string Sha256File(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(stream));
        }

        private static string Hex(byte[] value)
        {
            StringBuilder text = new StringBuilder(value.Length * 2);
            foreach (byte item in value) text.Append(item.ToString("x2", CultureInfo.InvariantCulture));
            return text.ToString();
        }

        private static void Show(string text, MessageBoxIcon icon)
        {
            Log(text.Replace("\r", " ").Replace("\n", " "));
            if (!_silent) MessageBox.Show(text, "PointBench 安装程序", MessageBoxButtons.OK, icon);
        }

        private static void StartProgress(string title, string phase, int completed, int total, string detail)
        {
            if (_silent) return;
            CloseProgress();
            _progress = new ProgressWindow(title);
            _progress.Show();
            _progress.SetProgress(phase, completed, total, detail);
        }

        private static void UpdateProgress(string phase, int completed, int total, string detail, bool force)
        {
            if (_silent || _progress == null) return;
            if (!force && completed != total && (completed % 20) != 0) return;
            _progress.SetProgress(phase, completed, total, detail);
        }

        private static void CloseProgress()
        {
            if (_progress == null) return;
            _progress.Close();
            _progress.Dispose();
            _progress = null;
            Application.DoEvents();
        }

        private static void Log(string format, params object[] args)
        {
            File.AppendAllText(_logPath, DateTime.Now.ToString("o", CultureInfo.InvariantCulture) + " " + String.Format(CultureInfo.InvariantCulture, format, args) + Environment.NewLine, new UTF8Encoding(false));
        }
    }
}
