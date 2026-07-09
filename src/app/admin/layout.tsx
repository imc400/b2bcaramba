/**
 * Layout del panel. El guard de sesión vive en cada página (requireAdmin)
 * porque /admin/login comparte este segmento y no debe exigir sesión.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
