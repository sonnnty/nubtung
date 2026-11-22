'use client';

import React from 'react';
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
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  variant = 'primary',
  loading = false,
  modalId = 'confirm-dialog',
}: ConfirmDialogProps) {
  const { closeModal } = useHistoryModal({
    isOpen,
    onClose,
    modalId,
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={loading ? () => {} : closeModal}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={closeModal} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? 'กำลังดำเนินการ...' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2.5 text-sm text-ink leading-relaxed">
        <p>{description}</p>
        {detail && <p className="text-xs text-ink-muted">{detail}</p>}
      </div>
    </Modal>
  );
}
