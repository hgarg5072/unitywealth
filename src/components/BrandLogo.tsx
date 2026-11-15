import React, { useId } from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
  variant?: 'default' | 'onDark';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 36,
  className = '',
  variant = 'default',
}) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `uw-bg-${uid}`;
  const glowId = `uw-glow-${uid}`;
  const markId = `uw-mark-${uid}`;
  const arrowId = `uw-arrow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 select-none ${className}`}
    >
      <defs>
        <linearGradient id={bgId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          {variant === 'onDark' ? (
            <>
              <stop offset="0%" stopColor="#1e1b4b" />
              <stop offset="60%" stopColor="#312e81" />
              <stop offset="100%" stopColor="#3730a3" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#1e1b4b" />
              <stop offset="52%" stopColor="#3730a3" />
              <stop offset="100%" stopColor="#4f46e5" />
            </>
          )}
        </linearGradient>
        <radialGradient id={glowId} cx="76%" cy="20%" r="60%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={markId} x1="15" y1="36" x2="46" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="38%" stopColor="#f8fafc" />
          <stop offset="68%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <linearGradient id={arrowId} x1="34" y1="25" x2="48" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#a7f3d0" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="16" fill={`url(#${bgId})`} />
      <rect width="64" height="64" rx="16" fill={`url(#${glowId})`} />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="15"
        stroke="#ffffff"
        strokeOpacity={variant === 'onDark' ? '0.28' : '0.16'}
        strokeWidth="1.5"
      />

      <path
        d="M 16.5 22.5 L 16.5 35.5 A 13 13 0 0 0 42.5 35.5 L 42.5 16"
        stroke={`url(#${markId})`}
        strokeWidth="7.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 33.8 24.2 L 42.5 15.5 L 51.2 24.2"
        stroke={`url(#${arrowId})`}
        strokeWidth="7.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default BrandLogo;
