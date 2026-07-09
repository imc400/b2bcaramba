"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { triggerFullSyncAction } from "./actions";

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        variant="success"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await triggerFullSyncAction();
            setMessage(result.message);
          })
        }
      >
        {pending ? "Encolando…" : "⟳ Sincronizar catálogo ahora"}
      </Button>
      {message ? <p className="text-xs text-caramba-grafito/55">{message}</p> : null}
    </div>
  );
}
