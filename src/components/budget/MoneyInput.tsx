"use client";

import { useState } from "react";
import { calculate, money } from "@/lib/budget";
import { useUi } from "../ui";

// 금액 칸 — 숫자 또는 "=10000*4" 계산식. 입력하는 동안 합계가 바로 바뀌고, 칸을 떠나면 천 단위 표시
export function MoneyInput({
  value,
  formula,
  readOnly,
  label,
  hint,
  onCommit,
}: {
  value: number;
  formula?: string;
  readOnly?: boolean;
  label: string;
  hint?: string; // 마우스를 올리면 보이는 참고(전년 실적 등)
  onCommit: (value: number, formula: string | undefined) => void;
}) {
  const { notify } = useUi();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  return (
    <input
      className={`money-input${invalid ? " invalid" : ""}`}
      value={focused ? text : money(value)}
      readOnly={readOnly}
      aria-label={label}
      aria-invalid={Boolean(invalid)}
      title={[formula && `계산식 ${formula}`, hint].filter(Boolean).join("\n") || undefined}
      inputMode="decimal"
      onFocus={() => {
        if (readOnly) return;
        setFocused(true);
        setText(formula ?? (value === 0 ? "" : String(value)));
      }}
      onChange={(e) => {
        if (readOnly) return;
        const next = e.target.value;
        setText(next);
        try {
          const v = calculate(next);
          setInvalid(null);
          onCommit(v, next.trim().startsWith("=") ? next.trim() : undefined);
        } catch (err) {
          setInvalid(err instanceof Error ? err.message : "금액을 확인해 주세요.");
        }
      }}
      onBlur={() => {
        if (invalid) notify(`${label}: ${invalid} — 마지막으로 올바른 값으로 되돌렸습니다.`, true);
        setInvalid(null);
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
