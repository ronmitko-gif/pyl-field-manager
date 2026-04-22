'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/coaches', label: 'Coaches' },
  { href: '/admin/fields', label: 'Fields' },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/notifications', label: 'Notifications' },
];

export function AdminNav({ pendingRequests = 0 }: { pendingRequests?: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 overflow-x-auto whitespace-nowrap border-b border-tj-black/10 bg-white px-6 py-2 text-sm">
      {LINKS.map((l) => {
        const isActive =
          l.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(l.href);
        const showBadge = l.href === '/admin/requests' && pendingRequests > 0;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              isActive
                ? 'underline underline-offset-4 decoration-tj-gold decoration-2'
                : 'text-tj-black/70 hover:text-tj-black'
            }
          >
            {l.label}
            {showBadge && (
              <span className="ml-1 rounded-full bg-tj-gold px-1.5 py-0.5 text-xs font-medium text-tj-black">
                {pendingRequests}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
