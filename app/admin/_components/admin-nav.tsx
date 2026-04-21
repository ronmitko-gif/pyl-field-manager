'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/coaches', label: 'Coaches' },
  { href: '/admin/fields', label: 'Fields' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b border-tj-black/10 bg-white px-6 py-2 text-sm">
      {LINKS.map((l) => {
        const isActive =
          l.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(l.href);
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
          </Link>
        );
      })}
    </nav>
  );
}
