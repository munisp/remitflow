import React from "react";

interface TotpFieldProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  disabled?: boolean;
}

/**
 * Reusable 6-digit TOTP step-up input. The collected code is passed as
 * `totpCode` on the bdc.* mutations that require step-up auth (SPEC §0.5d).
 */
const TotpField: React.FC<TotpFieldProps> = ({
  value,
  onChange,
  label = "TOTP step-up code",
  disabled,
}) => (
  <div>
    <label className="block text-xs font-medium text-slate-500 mb-1">
      {label}
    </label>
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="000000"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="w-32 px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
    />
    {value.length > 0 && value.length < 6 && (
      <p className="text-xs text-amber-600 mt-1">Enter all 6 digits</p>
    )}
  </div>
);

export default TotpField;
