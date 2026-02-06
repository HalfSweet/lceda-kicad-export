# KiCad Export (LCEDA Pro 扩展)

本仓库基于 LCEDA Pro 扩展 SDK 模板实现了一个可安装的扩展：将指定器件（符号、封装、可选 3D STEP）导出为 KiCad 格式，并打包为一个 ZIP 下载。

导出内容（ZIP 内）：

- `${baseName}.kicad_sym` (KiCad 符号库)
- `${baseName}.pretty/*.kicad_mod` (KiCad 封装库)
- `${baseName}.3dshapes/*.step` (可选，3D 模型)
- `README.txt` (导入说明)

## 使用方式

1. 安装扩展

- 运行构建：`pnpm build`
- 在 LCEDA Pro 中安装 `build/dist/` 下生成的 `.eext` 文件

2. 导出器件

扩展菜单：

- SCH/PCB：`KiCad Export` -> `Export Selected to KiCad...`
- Home/SCH/PCB：`KiCad Export` -> `Export by LCSC ID...`

支持两种入口：

- 从当前原理图/PCB 选中的器件导出（支持多选批量，自动去重）
- 输入一个或多个 LCSC 编号（例如 `C8734`），批量导出

3. 在 KiCad 中导入

- 解压 ZIP 到 KiCad 工程目录（推荐）
- 在 KiCad 添加符号库：选择 `${baseName}.kicad_sym`，库昵称必须设置为 `${baseName}`
- 在 KiCad 添加封装库：选择 `${baseName}.pretty`，库昵称必须设置为 `${baseName}`

说明：符号中的 Footprint 字段按 `${baseName}:<footprint>` 生成，因此封装库昵称必须与 `${baseName}` 一致，才能自动关联封装。

## 常见问题

1. 没有导出 3D

- 3D STEP 下载依赖扩展的“外部交互”权限与在线环境
- 如果未授权或处于离线模式，扩展会跳过 3D，但仍会导出符号与封装

2. 导出失败如何调试

- 打开 LCEDA Pro 的“日志”面板，查看以 `[KiCad Export]` 开头的日志
- 导出失败时扩展也会触发日志导出（`eda.sys_Log.export`），便于进一步定位

## 开发方式

环境要求：

- Node.js `>= 20.17.0`
- `pnpm`（本仓库仅支持 pnpm）

常用命令：

- 安装依赖：`pnpm install`
- 代码检查：`pnpm lint`
- 仅编译：`pnpm compile`
- 编译并打包 `.eext`：`pnpm build`

目录结构（关键部分）：

- `extension.json`：扩展元信息与菜单绑定
- `src/index.ts`：扩展入口，导出菜单绑定函数
- `src/exporter/`：导出实现（选中/按 LCSC、读取库文档、v3 格式解析、转换、ZIP 打包）
- `src/vendor/`：移植的转换器代码（用于 EasyEDA shape -> KiCad）

开发文档：

- LCEDA Pro API Guide：`https://prodocs.lceda.cn/cn/api/guide/`

## 开源许可

本仓库使用 Apache License 2.0 开源协议，详见 `LICENSE`。
