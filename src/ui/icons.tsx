// Small stroke icons (24×24 grid), inherit currentColor.
const paths = {
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  scene: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  motion: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 7v5l3 2',
  background: 'M4 4h16v16H4z M4 15c4-4 8 2 16-3',
  presets: 'M6 3h12v18l-6-4-6 4z',
  export: 'M12 3v12 M7 10l5 5 5-5 M5 20h14',
  play: 'M8 5l11 7-11 7z',
  pause: 'M7 5h3v14H7z M14 5h3v14h-3z',
  restart: 'M4 12a8 8 0 1 0 2.5-5.8 M4 4v4h4',
  upload: 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
  keyboard: 'M3 7h18v10H3z M7 11h.01 M11 11h.01 M15 11h.01 M8 14h8',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}
