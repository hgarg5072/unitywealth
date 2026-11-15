import React from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
  variant?: 'default' | 'onDark';
  lockup?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 36,
  className = '',
  lockup = false,
}) => {
  if (lockup) {
    return (
      <img
        src="/logo-lockup.png?v=4"
        alt="UnityWealth — Portfolio & Rebalancing"
        style={{ height: size, width: 'auto' }}
        className={`shrink-0 select-none object-contain ${className}`}
        draggable={false}
      />
    );
  }

  return (
    <img
      src="/logo-mark.png?v=4"
      width={size}
      height={size}
      alt="UnityWealth"
      style={{ width: size, height: size }}
      className={`shrink-0 select-none object-contain ${className}`}
      draggable={false}
    />
  );
};

export default BrandLogo;
