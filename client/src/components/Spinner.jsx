import React from 'react';

export const Spinner = ({
  size = 'md', // 'sm' | 'md' | 'lg' | 'xl'
  fullPage = false,
  className = '',
}) => {
  const sizes = {
    sm: 'h-4 w-4 stroke-[3]',
    md: 'h-8 w-8 stroke-[2.5]',
    lg: 'h-12 w-12 stroke-[2]',
    xl: 'h-16 w-16 stroke-[1.5]',
  };

  const spinnerContent = (
    <svg
      className={`animate-spin-fast text-blue-600 ${sizes[size]} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  if (fullPage) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white bg-opacity-70 backdrop-blur-sm">
        <div className="flex flex-col items-center space-y-3">
          {spinnerContent}
          <span className="text-sm font-medium text-slate-500">Processing request...</span>
        </div>
      </div>
    );
  }

  return spinnerContent;
};

export default Spinner;
