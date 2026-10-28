"use client";

import { useState } from "react";
import { Modal, useUi } from "../ui";

// 복사한 메모는 화면을 옮겨도 남도록 모듈 변수에 둔다(원본의 copiedBudgetMemo)
let copiedMemo = "";

export function MemoDialog({
  title,
  value,
  readOnly,
  otherMonthsFilled,
  onChange,
  onPasteAll,
  onClose,
}: {
  title: string;
  value: string;
  readOnly: boolean;
  otherMonthsFilled: boolean;
  onChange: (text: string) => void;
  onPasteAll: (text: string) => void;
  onClose: () => void;
}) {
  const { notify } = useUi();
  const [text, setText] = useState(value);
  const [status, setStatus] = useState(readOnly ? "마감 — 조회만 가능" : "입력하면 자동 저장됩니다");

  const set = (next: string) => {
    setText(next);
    onChange(next);
  };

  return (
    <Modal
      className="memo-dialog"
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="muted">{status}</span>
          <div className="actions">
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => {
                copiedMemo = text;
                setStatus("메모를 복사했습니다");
              }}
            >
              복사
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                if (!copiedMemo) return notify("먼저 메모를 복사해 주세요.");
                set(copiedMemo);
                setStatus("붙여넣었습니다");
              }}
            >
              붙여넣기
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                if (!copiedMemo) return notify("먼저 메모를 복사해 주세요.");
                if (otherMonthsFilled && !confirm("다른 월에 입력된 메모가 있습니다. 전체 월을 복사한 메모로 바꿀까요?")) return;
                setText(copiedMemo);
                onPasteAll(copiedMemo);
                setStatus("전체 월에 붙여넣었습니다");
              }}
            >
              전체 월 붙여넣기
            </button>
            <button type="button" className="primary" onClick={onClose}>
              완료
            </button>
          </div>
        </>
      }
    >
      <textarea
        aria-label="메모 내용"
        placeholder="산출근거나 참고사항을 입력하세요."
        value={text}
        readOnly={readOnly}
        autoFocus
        onChange={(e) => set(e.target.value)}
      />
    </Modal>
  );
}
