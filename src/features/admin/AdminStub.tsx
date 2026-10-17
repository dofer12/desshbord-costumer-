/** What a page of the Admin area shows until its screen is built. */
export function AdminStub({ title }: { title: string }) {
  return (
    <section className="admin-section">
      <h3>{title}</h3>
      <p className="sub">המסך הזה עוד לא נבנה.</p>
    </section>
  )
}
