# 后端运行

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

默认服务地址为 `http://127.0.0.1:8000`，接口文档为 `http://127.0.0.1:8000/docs`。

数据文件：

- SQLite: `backend/test_point.db`
- 原始 zip: `backend/storage/imports/`
- 项目文件: `backend/storage/projects/<project_id>/`
- 临时导入: `backend/storage/temp/`
