"use client";

import { useState } from "react";
import { MONTHS, money, sum } from "@/lib/budget";
import { api, type ApiError } from "@/lib/client";
import type { FeeRow, RevenuePlan } from "@/lib/types";
import { MoneyInput } from "../budget/MoneyInput";
import { Modal, useUi } from "../ui";

// 매출 예산안의 한 줄(수수료 또는 매출원가) 월별 금액 입력 — 경영지원
export function PlanRowDialog({ plan, field, index, onSaved, onClose }: { plan: RevenuePlan; field: "fees" | "cogs"; index: number; onSaved: (plan: RevenuePlan) => void; onClose: () => void }) {
  const { notify } = useUi();
  const row = plan[field][index];
  const [values, setValues] = useState(row.values.slice());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const rows: FeeRow[] = plan[field].map((r, i) => (i === index ? { ...r, values } : r));
      const res = await api<{ plan: RevenuePlan }>("/api/revenue", { method: "PATCH", body: JSON.stringify({ revision: plan.revision, [field]: rows }) });
      onSaved(res.plan);
      notify(`${row.label} 금액을 저장했습니다.`);
      onClose();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body.plan) {
        onSaved(err.body.plan as RevenuePlan);
        notify("다른 화면에서 먼저 고쳤습니다. 최신 값으로 다시 열어 주세요.", true);
        onClose();
      } else notify(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      className="fee-dialog"
      title={`${row.label} · 월별 금액`}
      onClose={onClose}
      footer={
        <>
          <span className="muted">연간 합계 {money(sum(values))}원 · 계산식(=…) 가능</span>
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      <div className="fee-fields">
        {values.map((v, m) => (
          <label key={m}>
            {MONTHS[m]}
            <MoneyInput value={v} label={`${row.label} ${MONTHS[m]}`} onCommit={(value) => setValues((list) => list.map((x, k) => (k === m ? Math.max(0, value) : x)))} />
          </label>
        ))}
      </div>
    </Modal>
  );
}
