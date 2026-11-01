/// <reference types="vite/client" />

/** Version of the `kgdiff` CLI package (vite.config.ts `define`). */
declare const __KGDIFF_VERSION__: string;
/** GitHub repository URL, without a trailing slash (vite.config.ts `define`). */
declare const __KGDIFF_REPO_URL__: string;

declare module 'virtual:kgdiff/payload/*' {
  import type { ReportPayload } from '@kgdiff/viewer';

  const payload: ReportPayload;
  export default payload;
}

declare module 'virtual:kgdiff/stats' {
  import type { ChangeFamily } from '@kgdiff/scene';

  export interface DatasetStats {
    readonly id: string;
    readonly hunks: number;
    readonly families: Readonly<Record<ChangeFamily, number>>;
    readonly nodes: { readonly before: number; readonly after: number };
    readonly edges: { readonly before: number; readonly after: number };
  }
  const stats: readonly DatasetStats[];
  export default stats;
}

declare module 'virtual:kgdiff/standalone' {
  /** URL of the standalone viewer bundle (IIFE) that HTML reports inline. */
  export const viewerUrl: string;
  /** URL of the optional compute add-on (diff + layout in the report). */
  export const computeUrl: string;
}
