'use client';

import React, { useEffect, useRef } from 'react';
import { Alert } from './Alert';
import { Modal } from './Modal';
import { Button } from './Button';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  detail?: string;
  error?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'destructive';
  loading?: boolean;
  modalId?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  detail,
  error,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  variant = 'primary',
  loading = false,
  modalId = 'confirm-dialog',
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(loading);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const { closeModal } = useHistoryModal({
    isOpen,
    onClose: () => {
      if (!loadingRef.current) onClose();
    },
    modalId,
    enableEsc: !loading,
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={loading ? () => {} : closeModal}
      title={title}
      size="sm"
      initialFocusRef={cancelButtonRef}
      disableClose={loading}
      footer={
        <>
          <Button ref={cancelButtonRef} variant="secondary" onClick={closeModal} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? 'กำลังดำเนินการ...' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2.5 text-sm text-ink leading-relaxed">
        {error && <Alert variant="error">{error}</Alert>}
        <p>{description}</p>
        {detail && <p className="text-xs text-ink-muted">{detail}</p>}
      </div>
    </Modal>
  );
}
