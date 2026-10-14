<script lang="ts">
  export let name: string;
  export let size = 20;
  const paths: Record<string, string> = {
    pointer: 'm4 3 7 18 2-8 8-2z',
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    scan: 'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M21 16v3a2 2 0 0 1-2 2h-3 M8 21H5a2 2 0 0 1-2-2v-3 M8 8h8v8H8z',
    chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z',
    note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    arrow: 'M7 17 17 7 M7 7h10v10',
    close: 'm6 6 12 12 M6 18 18 6',
    plus: 'M12 5v14 M5 12h14',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    send: 'm5 12 7-7 7 7 M12 5v14',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
    key: 'M15 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M11 11H3v4 M6 11v3',
    terminal: 'm4 6 6 6-6 6 M13 18h7',
    image: 'M3 3h18v18H3z m0 14 6-6 5 5 3-3 4 4 M16 7h.01',
    stop: 'M6 6h12v12H6z',
    check: 'm5 12 4 4L19 6',
    edit: 'm16 3 5 5 M4 16 16 4a2.1 2.1 0 0 1 3 3L7 19l-4 1z',
    trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    power: 'M12 2v10 M6 5a9 9 0 1 0 12 0',
    chevron: 'm6 9 6 6 6-6',
    upload: 'M12 16V3 m-5 5 5-5 5 5 M4 16v5h16v-5',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
    play: 'm8 4 12 8-12 8z',
    undo: 'M3 10h11a6 6 0 0 1 0 12 M3 10l6-6 M3 10l6 6',
    sun: 'M12 3V1 M12 23v-2 M3 12H1 M23 12h-2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    moon: 'M20.5 13a9 9 0 1 1-9.5-9.5A7 7 0 0 0 20.5 13z',
    monitor: 'M3 3h18v14H3z M12 17v4 M8 21h8',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'eye-off': 'M3 3l18 18 M10 5h2c6 0 10 7 10 7a22 22 0 0 1-4 4 M6 6a22 22 0 0 0-4 6s4 7 10 7h2',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] ?? paths.spark} />
</svg>
