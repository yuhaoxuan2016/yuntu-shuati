/// <reference types="vite/client" />

// 构建期注入的真实版本（vite.config.ts 的 define，取自 package.json）
declare const __APP_VERSION__: string

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'mammoth' {
  export interface ConvertResult {
    value: string
    messages: any[]
  }
  export function convertToHtml(options: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>
}
