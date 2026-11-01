const PATHS = {
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.6l3.8-1 3.1 15.6-3.8 1z',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 5.2l1.6 1.2-2 3.4-1.9-.7a7.7 7.7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7.7 7.7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7.800 7.800 0 0 1 0-2l-1.600-1.200 2-3.400 1.900.7a7.700 7.700 0 0 1 1.700-1l.3-2h4l.3 2a7.700 7.700 0 0 1 1.700 1l1.900-.7 2 3.400-1.600 1.200a7.800 7.800 0 0 1 0 2z',
  back: 'M15.5 4.5L8 12l7.500 7.500-1.500 1.500L5 12l9-9z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  more: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  folder: 'M3 5h7l2 2h9v12H3z',
  close:
    'M5.500 4L12 10.500 18.500 4 20 5.500 13.500 12 20 18.500 18.500 20 12 13.500 5.500 20 4 18.500 10.500 12 4 5.500z',
  search:
    'M10 3a7 7 0 1 0 4.200 12.600l5.100 5.100 1.400-1.400-5.100-5.100A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  play: 'M7 4l13 8-13 8z',
  sliders: 'M4 6h9v2H4zM17 5h3v4h-3zM13 5h4v2h-4zM4 16h3v2H4zM11 15h9v2h-9zM7 14h4v4H7z',
  list: 'M4 5h16v2H4zM4 11h16v2H4zM4 17h16v2H4z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
