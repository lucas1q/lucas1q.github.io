# 课程时间查询：本地安全模式

这是一个可由 GitHub Pages 托管的纯静态站点，不包含安全后端。

## 当前行为

- 手动添加课程，粘贴或导入 UTF-8 TXT / DOCX 文本，并在保存前编辑解析结果
- 从当前浏览器的 `localStorage` 读取、保存课程；姓名仅作为文本显示
- 导出 JSON 备份，或导入备份后检查并追加课程
- 不访问旧云端课程库，不发送图片、文档或课程数据；PDF / 图片 OCR 与多人共享暂时停用
- 资源全部从本站加载，无运行时 CDN 脚本；CSP 禁止网络 API 连接和内联脚本

每个浏览器 / 网站来源单独存储课程。清除网站数据、使用隐私模式或存储被禁用可能造成数据不可用。请定期导出备份，不要在共用设备上存放不应被其他使用者看到的姓名。备份包含姓名和课程信息，也需妥善保管。不要同时在多个标签页保存，以免极端并发写入覆盖数据。

原云端数据不会自动迁移或被删除。管理员可在原服务中自行导出、核对并转换为以下 JSON 数组，再使用页面导入；本修复不会请求原数据接口。

```json
{
  "schemaVersion": 1,
  "courses": [
    { "student_name": "示例", "day": "1", "start_time": "09:00", "end_time": "10:00" }
  ]
}
```

星期取 0–6（周日–周六）；时间使用 24 小时制 `HH:MM`，结束须晚于开始，不支持跨午夜课程。每行课程文本示例：`示例 周一 09:00-10:00`。日期按浏览器本地时区计算；上课区间包含开始、不包含结束。

上传文件最大 10MB，DOCX 展开正文最大 2MB，课程文本最多 100,000 字符，本地最多保存 1,000 条课程。DOCX 只读取正文文字和表格文字，不执行宏、不加载外部内容；复杂排版或扫描图片请手工转为文本并核对。

## 本地运行和验证

Node.js 18+：

```sh
node --check app.js
node tests/security.cjs
python3 -m http.server 8000
```

浏览器打开 `http://localhost:8000`。不要依赖 `file://` 来源的存储行为。

`tests/security.cjs` 不需要安装依赖。它使用 Node、仓库内 JSZip 及小型 DOM 测试替身验证输入、持久化、DOM 构造和 ZIP 处理；不能替代真实浏览器或视觉验证。

完整 Chromium 回归测试：

```sh
npm install --no-save playwright@1.62.1
CHROMIUM_PATH=/usr/bin/chromium node tests/browser.cjs
```

测试使用临时本地服务器、独立浏览器上下文和合成数据，不请求生产服务。

## 验证状态

安全修复提交前：JavaScript 语法检查、14 组 Node 回归检查通过。独立代码复查发现的 UTF-8 异常处理、DOCX 换行和时间边界问题已修复并纳入回归。

Chromium 回归脚本已编写，但本次环境因浏览器进程创建本地 socket 被阻止而未执行成功；不代表浏览器行为、CSP 强制执行、移动端布局或下载流程已通过。合并前请在允许运行 Chromium 的环境完成该检查。

## 恢复云端功能前

见 [SECURITY.md](SECURITY.md)。不要把新密钥放进前端配置或所谓的前端环境变量。

## 第三方依赖

`vendor/jszip-3.10.2.min.js` 来自 [JSZip v3.10.2 官方发行文件](https://github.com/Stuk/jszip/blob/v3.10.2/dist/jszip.min.js)，使用随附的 MIT 许可。许可证见 `vendor/JSZip-LICENSE.md`，依赖自带版权声明保留。静态 CSS 替代原运行时样式 CDN，以允许只加载本站脚本的 CSP。
