import { useRef, useEffect, useState } from 'react';
import logoSrc from '@/assets/logo.webp';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  interactive?: boolean;
}

const sizeMap = {
  sm: 'w-10 h-10',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
  xl: 'w-32 h-32',
};

export function Logo({ size = 'md', interactive = true }: LogoProps) {
  const logoRef = useRef<HTMLImageElement>(null);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!interactive) return;

    const handleMove = (clientX: number, clientY: number) => {
      if (!logoRef.current) return;

      const rect = logoRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = clientX - centerX;
      const dy = clientY - centerY;

      // Angle in radians → degrees
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      // Subtle rotation (clamped)
      setRotation(angle); 
    };

    const handleMouseMove = (e: MouseEvent) =>
      handleMove(e.clientX, e.clientY);

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const reset = () => setRotation(0);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('mouseleave', reset);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseleave', reset);
    };
  }, [interactive]);

  return (
    <img
      ref={logoRef}
      src={logoSrc}
      alt="Logo"
      className={`${sizeMap[size]} transition-transform duration-200 ease-out select-none`}
      style={{
        transform: `rotate(${rotation}deg)`,
      }}
      draggable={false}
      loading='lazy'
      decoding='async'
    />
  );
}
