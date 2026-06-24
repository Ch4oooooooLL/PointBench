export interface Project {
  id: number;
  project_id: string;
  project_name: string;
  test_object?: string | null;
  test_type?: string | null;
  department?: string | null;
  vehicle_or_product?: string | null;
  test_stage?: string | null;
  description?: string | null;
  source_export_id?: string | null;
  source_export_time?: string | null;
  created_at: string;
  updated_at: string;
  point_count: number;
}

export interface MediaFile {
  id: number;
  photo_id?: string | null;
  type: string;
  path: string;
  filename: string;
  taken_time?: string | null;
  sha256?: string | null;
  remark?: string | null;
}

export interface SensorChannel {
  id: number;
  device?: string | null;
  channel_name?: string | null;
  unit?: string | null;
  sample_rate_hz?: number | null;
  remark?: string | null;
}

export interface CaeMapping {
  id: number;
  cae_point_id?: string | null;
  cae_component?: string | null;
  cae_result_type?: string | null;
  danger_level?: string | null;
  remark?: string | null;
}

export interface Measurement {
  id: number;
  run_id: number;
  point_db_id: number;
  max_strain_ue?: number | null;
  min_strain_ue?: number | null;
  mean_strain_ue?: number | null;
  amplitude_strain_ue?: number | null;
  range_strain_ue?: number | null;
  stress_max_mpa?: number | null;
  stress_min_mpa?: number | null;
  stress_mean_mpa?: number | null;
  stress_amplitude_mpa?: number | null;
  stress_range_mpa?: number | null;
  is_abnormal: boolean;
  abnormal_reason?: string | null;
  remark?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Point {
  id: number;
  project_db_id: number;
  point_id: string;
  point_name: string;
  point_type: string;
  component?: string | null;
  side?: string | null;
  position_description?: string | null;
  direction?: string | null;
  bridge_type?: string | null;
  resistance_ohm?: number | null;
  install_status: string;
  check_status?: string | null;
  remark?: string | null;
  channels: SensorChannel[];
  media_files: MediaFile[];
  cae_mappings?: CaeMapping[];
  latest_measurement?: Pick<Measurement, 'amplitude_strain_ue' | 'stress_amplitude_mpa' | 'is_abnormal'> | null;
}

export interface TestRun {
  id: number;
  project_db_id: number;
  run_name: string;
  cycle_count: number;
  test_time?: string | null;
  remark?: string | null;
  created_at: string;
}

export interface ImportPreview {
  temporary_import_id: string;
  export_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  point_count: number;
  photo_count: number;
  missing_files: string[];
  duplicate_point_ids: string[];
  duplicate_channel_names: string[];
  warnings: string[];
  errors: string[];
  can_import: boolean;
}

export interface TrendItem {
  run_id: number;
  run_name: string;
  cycle_count: number;
  max_strain_ue?: number | null;
  min_strain_ue?: number | null;
  amplitude_strain_ue?: number | null;
  stress_amplitude_mpa?: number | null;
  is_abnormal: boolean;
  abnormal_reason?: string | null;
}

export interface DewesoftChannel {
  id: number;
  import_id: number;
  channel_name: string;
  unit?: string | null;
  sample_count?: number | null;
  matched_point_db_id?: number | null;
  measurement_id?: number | null;
  stable_min_strain_ue?: number | null;
  stable_max_strain_ue?: number | null;
  stable_mean_strain_ue?: number | null;
  raw_json?: string | null;
  created_at: string;
}

export interface DewesoftImport {
  id: number;
  project_db_id: number;
  test_run_id?: number | null;
  cycle_count: number;
  run_name: string;
  filename: string;
  stored_path: string;
  status: string;
  message?: string | null;
  duration_seconds?: number | null;
  stable_start_seconds?: number | null;
  stable_end_seconds?: number | null;
  matched_channel_count: number;
  unmatched_channel_count: number;
  raw_metadata_json?: string | null;
  created_at: string;
  channels: DewesoftChannel[];
}
