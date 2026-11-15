import React from 'react';

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
  return (
    <img
      src="/logo-mark.png?v=5"
      width={size}
      height={size}
      alt="UnityWealth"
      style={{ width: size, height: size }}
      className={`shrink-0 select-none object-contain ${
        variant === 'onDark' ? 'bg-white rounded-xl p-1' : ''
      } ${className}`}
      draggable={false}
    />
  );
};

export default BrandLogo;
