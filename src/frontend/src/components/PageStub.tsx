import type { ReactNode } from 'react';

// Shared placeholder used by Wave-0 stub pages. Renders the standard top-bar +
// page-body chrome (matching mvp/) so stub routes already look right; Wave-2
// agents replace each page body without touching the router.

export interface PageStubProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageStub({ title, subtitle, actions, children }: PageStubProps) {
  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">{title}</span>
          {subtitle && <span className="top-bar-sub">{subtitle}</span>}
        </div>
        {actions && <div className="top-bar-actions">{actions}</div>}
      </div>
      <div className="page-body">
        {children ?? (
          <div className="panel">
            <div className="panel-body-padded text-muted">
              <strong>{title}</strong> — placeholder. This screen is implemented in Wave 2.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
