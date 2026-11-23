import type { ReactNode, SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function Svg({ children, size = 18, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ChatIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21 11.6c0 4.2-4 7.6-9 7.6-1 0-2-.1-2.9-.4L4 21l1.2-3.6C3.8 15.9 3 13.9 3 11.6 3 7.4 7 4 12 4s9 3.4 9 7.6Z" />
  </Svg>
);

export const FolderIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.1c.6 0 1.1.2 1.5.7l1.3 1.5h7.1A2.5 2.5 0 0 1 21 9.7v7.8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z" />
  </Svg>
);

export const UsersIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 11a3 3 0 1 0-1.2-5.7" />
    <path d="M17 14.5a4.6 4.6 0 0 1 3.5 3.9" />
  </Svg>
);

export const ShieldIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3.2 19 6v5.4c0 4.4-2.9 8-7 9.4-4.1-1.4-7-5-7-9.4V6Z" />
    <path d="m9.3 12 1.9 1.9 3.5-3.6" />
  </Svg>
);

export const LockIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.6" />
    <path d="M8 10V7.8a4 4 0 0 1 8 0V10" />
  </Svg>
);

export const SendIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m4.4 11.5 14.7-6.7a.7.7 0 0 1 .9.9l-6.2 14.4a.7.7 0 0 1-1.3-.1l-1.6-5.5a1 1 0 0 0-.7-.7l-5.7-1.5a.7.7 0 0 1-.1-1.3Z" />
  </Svg>
);

export const PaperclipIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 11.5 12.7 18.8a4.6 4.6 0 0 1-6.5-6.5l7.6-7.6a3.1 3.1 0 0 1 4.4 4.4l-7.6 7.6a1.6 1.6 0 0 1-2.2-2.2l6.9-6.9" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3.5v11" />
    <path d="m8 11 4 4 4-4" />
    <path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4.5 6.5h15" />
    <path d="M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.5" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);

export const PinIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 3.5h6l-1 5.2 3.5 3.3v1.5h-11V12L10 8.7Z" />
    <path d="M12 13.5V20.5" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const XIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const LogOutIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M14 4.5H6.5A2.5 2.5 0 0 0 4 7v10a2.5 2.5 0 0 0 2.5 2.5H14" />
    <path d="M17 8.5 20.5 12 17 15.5" />
    <path d="M20.5 12H10" />
  </Svg>
);

export const KeyIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="15.5" r="3.5" />
    <path d="m10.5 13 8-8" />
    <path d="m15.5 8 2 2M18 5.5l2 2" />
  </Svg>
);

export const MenuIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);

export const AlertIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 4.5 21 20H3Z" />
    <path d="M12 10v4.2M12 17.3v.2" />
  </Svg>
);

export const FileIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5Z" />
    <path d="M14 3.5V8.5H19" />
  </Svg>
);

export const FileTextIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5Z" />
    <path d="M14 3.5V8.5H19" />
    <path d="M8.5 12.5h7M8.5 16h4.5" />
  </Svg>
);

export const ImageIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 17 4.2-4.2a2 2 0 0 1 2.8 0l3.3 3.3a2 2 0 0 0 2.8 0L20.5 13" />
  </Svg>
);

export const ArchiveIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="4" width="17" height="5" rx="1.6" />
    <path d="M5 9v9.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V9" />
    <path d="M10 13h4" />
  </Svg>
);

export const MusicIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 18V6.8l9-2.3v10.9" />
    <circle cx="6.6" cy="18" r="2.4" />
    <circle cx="15.6" cy="15.4" r="2.4" />
  </Svg>
);

export const VideoIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="6" width="12" height="12" rx="2.5" />
    <path d="m15.5 11 5-2.8v7.6l-5-2.8" />
  </Svg>
);

export const CodeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
  </Svg>
);

export const SheetIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="4" width="16" height="16" rx="2.4" />
    <path d="M4 9.5h16M4 15h16M10 9.5V20" />
  </Svg>
);

export const RefreshIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 11.5A8 8 0 0 0 6.3 6.8L4 9" />
    <path d="M4 4.5V9h4.5" />
    <path d="M4 12.5a8 8 0 0 0 13.7 4.7L20 15" />
    <path d="M20 19.5V15h-4.5" />
  </Svg>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const SparklesIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8Z" />
    <path d="M18.5 15.5l.7 1.9 1.8.6-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.6Z" />
  </Svg>
);

export const EyeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const EyeOffIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m4 4 16 16" />
    <path d="M9.8 6.9A9.6 9.6 0 0 1 12 6.5c6 0 9.2 5.5 9.2 5.5a17 17 0 0 1-3.4 3.8" />
    <path d="M6.4 8.3A16.6 16.6 0 0 0 2.8 12S6 17.5 12 17.5a9.7 9.7 0 0 0 3.8-.8" />
    <path d="M10 10a2.8 2.8 0 0 0 4 4" />
  </Svg>
);

export const MoreIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
export const LanguagesIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 5h9M8.5 3v2M6 5c.6 3 2.6 5.6 5.5 7M11 5c-.8 3.6-3.2 6.4-7 8" />
    <path d="M13 21l4-9 4 9M14.5 18h5" />
  </Svg>
);

export const WandIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 20 15 9M14 4v2M19 9h2M17.5 5.5 19 4M12 7l5 5" />
  </Svg>
);
