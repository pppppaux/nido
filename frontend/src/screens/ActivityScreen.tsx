import { dayLabel, money, timeLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { Activity } from "../lib/types";
import { Avatar, Empty } from "../components/ui";

export function ActivityScreen() {
  const s = useStore();
  const feed = s.activity;

  function sentence(a: Activity): string {
    const who = a.user_id === s.me.id ? "Tú" : s.member(a.user_id)?.display_name ?? "Alguien";
    const mine = a.user_id === s.me.id;
    const d = a.detail as Record<string, number | boolean | null | undefined>;
    const forWhom = (ownerId: unknown) => {
      if (ownerId == null) return "";
      if (ownerId === a.user_id) return mine ? " para ti" : " para sí";
      return ownerId === s.me.id ? " para ti" : ` para ${s.member(ownerId as number)?.display_name ?? "alguien"}`;
    };
    switch (a.kind) {
      case "joined":
        return `${who} ${mine ? "te uniste" : "se ha unido"} a la casa`;
      case "added":
        return `${who} ${mine ? "apuntaste" : "apuntó"} ${a.subject}${forWhom(d.owner_id)}${d.urgent ? ", con prisa" : ""}`;
      case "bought":
        return `${who} ${mine ? "compraste" : "compró"} ${a.subject}${forWhom(d.owner_id)}${
          d.price_cents ? ` por ${money(d.price_cents as number)}` : ""
        }`;
      case "removed":
        return `${who} ${mine ? "quitaste" : "quitó"} ${a.subject} de la lista`;
      case "pantry_low":
        return `${who} ${mine ? "avisaste" : "avisó"} de que queda poco: ${a.subject}`;
      case "pantry_out":
        return `${who} ${mine ? "avisaste" : "avisó"} de que se ha acabado: ${a.subject}`;
      case "expense":
        return `${who} ${mine ? "añadiste" : "añadió"} el gasto ${a.subject} (${money(d.amount_cents as number)})`;
      case "expense_deleted":
        return `${who} ${mine ? "borraste" : "borró"} el gasto ${a.subject}`;
      case "settlement": {
        const from = d.from_user_id === s.me.id ? "ti" : s.member(d.from_user_id as number)?.display_name;
        const to = d.to_user_id === s.me.id ? "ti" : s.member(d.to_user_id as number)?.display_name;
        return `${who} ${mine ? "apuntaste" : "apuntó"} un pago de ${money(d.amount_cents as number)} de ${from} a ${to}`;
      }
      default:
        return `${who}: ${a.subject}`;
    }
  }

  return (
    <div className="pb-28">
      <h1 className="display mb-6 text-[56px]">Actividad</h1>
      {feed.length === 0 ? (
        <Empty title="Todavía no ha pasado nada">Lo que apuntéis, compréis o paguéis aparecerá aquí.</Empty>
      ) : (
        <ol className="space-y-1">
          {feed.map((a, idx) => {
            const showDay = idx === 0 || dayLabel(feed[idx - 1].created_at) !== dayLabel(a.created_at);
            return (
              <li key={a.id}>
                {showDay && <h2 className="mt-5 mb-2 px-1 text-[14px] font-medium text-muted first:mt-0">{dayLabel(a.created_at)}</h2>}
                <div className="flex items-start gap-3 rounded-2xl px-1 py-2">
                  <Avatar user={s.member(a.user_id)} size={30} />
                  <p className="min-w-0 flex-1 pt-1 text-[15px] leading-snug">{sentence(a)}</p>
                  <span className="tabular shrink-0 pt-1 text-[13px] text-faint">{timeLabel(a.created_at)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
