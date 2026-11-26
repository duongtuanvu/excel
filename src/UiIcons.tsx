import type { ReactNode } from 'react';

export type IconName =
  | 'logo'
  | 'upload'
  | 'download'
  | 'file'
  | 'grid'
  | 'table'
  | 'chart'
  | 'barChart'
  | 'pieChart'
  | 'lineChart'
  | 'filter'
  | 'settings'
  | 'sliders'
  | 'shield'
  | 'refresh'
  | 'plus'
  | 'minus'
  | 'close'
  | 'chevronRight'
  | 'chevronDown'
  | 'chevronLeft'
  | 'layers'
  | 'pivot'
  | 'pipeline'
  | 'model'
  | 'batch'
  | 'schema'
  | 'crop'
  | 'quality'
  | 'dashboard'
  | 'play'
  | 'eye'
  | 'maximize'
  | 'grip'
  | 'arrowUp'
  | 'arrowDown'
  | 'trash'
  | 'edit'
  | 'check'
  | 'alert'
  | 'info'
  | 'undo'
  | 'redo'
  | 'calendar'
  | 'user'
  | 'logout'
  | 'save'
  | 'folder'
  | 'text';

const PATHS: Record<IconName, ReactNode> = {
  logo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <path d="M7.5 16v-4.5m4.5 4.5V8m4.5 8v-6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M8.5 13h7M8.5 17h5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M9 9.5V20M15 9.5V20" />
    </>
  ),
  chart: <path d="M4 4v16h16M8 16v-5m4 5V7m4 9v-3" />,
  barChart: (
    <>
      <path d="M4 20h16" />
      <rect x="6" y="10" width="3" height="6" rx="1" />
      <rect x="10.5" y="6" width="3" height="10" rx="1" />
      <rect x="15" y="12" width="3" height="4" rx="1" />
    </>
  ),
  pieChart: (
    <>
      <path d="M21 12A9 9 0 1 1 12 3v9z" />
      <path d="M15.5 4.2A9 9 0 0 1 19.8 8.5H15.5z" />
    </>
  ),
  lineChart: (
    <>
      <path d="M4 4v16h16" />
      <path d="m7 14 4-4 3.5 3L19 8" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v5.5l-4 2V13z" />,
  settings: (
    <>
      <path d="M5 4v16M12 4v16M19 4v16" />
      <path d="M2.5 9h5M9.5 15h5M16.5 9h5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10m4 0h2M4 12h4m4 0h8M4 17h12m4 0h0" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="17" r="2" />
    </>
  ),
  shield: <path d="m12 3 8 3v6c0 4.2-3.5 7.2-8 9-4.5-1.8-8-4.8-8-9V6zm-3.5 9 2.5 2.5 4.5-4.5" />,
  refresh: (
    <>
      <path d="M20 7v4.5h-4.5M4 17v-4.5h4.5" />
      <path d="M5.5 9A7.5 7.5 0 0 1 18 6l2 2M18.5 15A7.5 7.5 0 0 1 6 18l-2-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  layers: <path d="m12 3 9 4.5-9 4.5-9-4.5zm-9 9 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />,
  pivot: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M9 3v18M15.5 13v3.5H12" />
      <path d="m14 11.5 1.5 1.5 1.5-1.5" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3" y="4" width="6" height="5" rx="1.2" />
      <rect x="15" y="4" width="6" height="5" rx="1.2" />
      <rect x="9" y="15" width="6" height="5" rx="1.2" />
      <path d="M6 9v2.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V9M12 13v2" />
    </>
  ),
  model: (
    <>
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="7" r="3" />
      <circle cx="12" cy="17" r="3" />
      <path d="M9.5 8.5 11 14.5M14.5 8.5 13 14.5" />
    </>
  ),
  batch: (
    <>
      <rect x="4" y="6" width="12" height="14" rx="2" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h9A1.5 1.5 0 0 1 20 4.5v11a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M7.5 11h5M7.5 15h3.5" />
    </>
  ),
  schema: (
    <>
      <path d="M4 7h16M4 12h10M4 17h7" />
      <path d="m16 14 2 2 3-3" />
    </>
  ),
  crop: (
    <>
      <path d="M6 3v12a3 3 0 0 0 3 3h12" />
      <path d="M3 6h12a3 3 0 0 1 3 3v12" />
    </>
  ),
  quality: (
    <>
      <path d="M9 12.5 11 14.5 15.5 10" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="8" height="9" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="14" width="8" height="7" rx="2" />
    </>
  ),
  play: <path d="M7 5.5v13l11-6.5z" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  maximize: <path d="M8 3H4v4m12-4h4v4M8 21H4v-4m12 4h4v-4" />,
  grip: (
    <>
      <circle cx="9" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  arrowUp: <path d="M12 19V5m-5.5 5.5L12 5l5.5 5.5" />,
  arrowDown: <path d="M12 5v14m-5.5-5.5L12 19l5.5-5.5" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 4h5M9 7v12a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V7" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  edit: <path d="M15.5 4.5 19.5 8.5 8.5 19.5H4.5v-4z" />,
  check: <path d="m5 12.5 4.5 4.5 9.5-9.5" />,
  alert: (
    <>
      <path d="M12 3.5 21 19.5H3z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7H4v5" />
      <path d="M4.5 11.5A7.5 7.5 0 1 1 7 18" />
    </>
  ),
  redo: (
    <>
      <path d="M15 7h5v5" />
      <path d="M19.5 11.5A7.5 7.5 0 1 0 17 18" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9" />
      <path d="M15 8l4.5 4L15 16M19 12H9" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7 3v5h8V3M7 21v-7h10v7" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  text: <path d="M4 6h16M12 6v13M8 19h8" />,
};

export function UiIcon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
