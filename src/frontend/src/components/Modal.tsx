import { useEffect, type ReactNode } from 'react';

// Generic overlay modal used for the management edit form (spec §7 "one clean
// isolated form") and as the shell for ArtifactDetailModal. Styling is local
// (styles/app.css .modal-*) and matches the mvp/ panel look.

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider modal for detail/history content. */
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className={`modal-card${wide ? ' modal-card-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
