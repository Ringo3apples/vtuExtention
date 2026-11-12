# VTU Node Processor (VS Code Extension)

**VTU Node Processor** は、FEM 解析などの `.vtu`（VTK Unstructured Grid）ファイルを VS Code 上で直接開き、ノードベースのビジュアルプログラミングで物理量の演算・可視化を行える拡張機能です（WebGPU / WebGL2 対応）。

## 主な機能

- **`.vtu` ファイルのダイレクト表示**：エクスプローラーで `.vtu` ファイルを選択して開くと、自動的に VTU Node Processor で表示されます。
- **ノードベースのデータフロー編集**：
  - `VTU データ入力`：VTU 内の `<PointData>` をスカラー・ベクトル成分（Mag / X / Y / Z）ごとに自動ポート展開
  - 演算ノード：定数、座標（X, Y, r）、2項演算、関数（`|x|`, `x²`, `√x`, `dB` 等）、自由数式、閾値マスクフィルター
  - 出力ノード：3D コンタ表示、直線プロファイル（Line Probe）、2D ベクトル矢印
- **パイプラインの保存・読込**：ノード構成を JSON ファイルとして保存・再読込可能
- **スタンドアロン動作**：`vtu_node_processor.html` を直接ブラウザで開いて使用することも可能

## インストール方法（.vsix から）

1. Releases 等から `vtu-node-processor-0.1.0.vsix` を入手します。
2. 以下のコマンド、または VS Code の拡張機能ビュー右上 `...` →「VSIX からのインストール...」からインストールします。

```bash
code --install-extension vtu-node-processor-0.1.0.vsix
```

## 開発・ビルド手順

```bash
# 依存パッケージ (Three.js) のインストール
npm install
```

- **デバッグ実行**：VS Code でこのフォルダを開き、`F5` キーを押して Extension Development Host を起動します。サンプルとして `example/coil_t0001.vtu` を同梱しています。
- **`.vsix` パッケージの作成**：

```bash
npx @vscode/vsce package --allow-missing-repository
```

## ライセンス

MIT License（詳細は同梱の `LICENSE` ファイルを参照してください）

