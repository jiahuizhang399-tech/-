# 报销截图自动整理 - 静态部署版

这是可直接部署到 Vercel、Netlify、GitHub Pages 或公司静态服务器的版本。

## 包含文件

- `index.html`
- `app.js`
- `styles.css`
- `overrides.css`
- `vercel.json`
- `netlify.toml`

## 推荐部署方式

### Vercel

1. 登录 Vercel。
2. 新建 Project。
3. 上传或导入这个 `dist` 目录。
4. Framework 选择 `Other`。
5. Build Command 留空。
6. Output Directory 留空或填 `.`。
7. 部署后获得 HTTPS 链接。

### Netlify

1. 登录 Netlify。
2. 选择 Add new site。
3. 直接拖拽整个 `dist` 文件夹。
4. 部署后获得 HTTPS 链接。

### GitHub Pages

1. 创建 GitHub 仓库。
2. 把 `dist` 内文件提交到仓库根目录。
3. 在仓库 Settings -> Pages 开启部署。
4. Source 选择 main branch。

## 使用说明

这是纯前端静态工具。截图和 PDF 都在浏览器本地处理，不会上传到服务器。

注意：刷新页面后，当前录入数据和已上传 PDF 不会保存。需要长期保存或多人协作时，再升级为飞书机器人/多维表格版本。
