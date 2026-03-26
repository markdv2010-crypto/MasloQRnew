import React, { useState, useEffect, useRef } from 'react';
import { cn } from './utils';

interface EditableNameProps {
  initialName?: string;
  onSave: (name: string) => void;
  placeholder?: string;
  className?: string;
  isGtin?: boolean;
}

export const EditableName = ({ initialName, onSave, placeholder, className, isGtin }: EditableNameProps) => {
  const [name, setName] = useState(initialName || '');
  const isFocused = useRef(false);
  
  useEffect(() => {
    if (!isFocused.current) {
      setName(initialName || '');
    }
  }, [initialName]);

  return (
    <input
      type="text"
      value={name}
      placeholder={placeholder}
      onFocus={() => { isFocused.current = true; }}
      onBlur={() => { 
        isFocused.current = false; 
        onSave(name); 
      }}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onSave(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "bg-transparent border-none focus:ring-1 focus:ring-blue-500/30 rounded w-full text-center outline-none transition-all",
        isGtin ? "text-[10px] font-mono text-white/80" : "text-[9px] line-clamp-2 px-1 mt-1 leading-tight",
        !initialName && !isGtin ? "text-white/30 bg-white/5 border border-white/10 text-[8px]" : "text-white/60",
        className
      )}
      title={isGtin ? "Нажмите, чтобы изменить GTIN" : "Нажмите, чтобы изменить название"}
    />
  );
};
