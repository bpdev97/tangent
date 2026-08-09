import { ChevronDownIcon, GitPullRequestIcon, TicketIcon } from "lucide-react";

import type { LinearPreviewPresentation } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

function isActiveDestination(currentUrl: string, destinationUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const destination = new URL(destinationUrl);
    return (
      current.origin === destination.origin &&
      current.pathname.replace(/\/$/, "") === destination.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

export function LinearPreviewToolbar(props: {
  readonly currentUrl: string;
  readonly presentation: LinearPreviewPresentation;
  readonly onNavigate: (url: string) => void;
}) {
  const { presentation } = props;
  const reviewUrl = presentation.reviewUrl;
  const singleTicket = presentation.tickets.length === 1 ? presentation.tickets[0] : null;
  const ticketsActive = presentation.tickets.some((ticket) =>
    isActiveDestination(props.currentUrl, ticket.url),
  );

  return (
    <div className="surface-subheader gap-1 px-2" data-linear-preview-toolbar>
      <span className="mr-1 shrink-0 text-xs font-medium text-muted-foreground">Linear</span>
      {reviewUrl ? (
        <Button
          size="xs"
          variant={isActiveDestination(props.currentUrl, reviewUrl) ? "secondary" : "ghost"}
          onClick={() => props.onNavigate(reviewUrl)}
        >
          <GitPullRequestIcon />
          Review
        </Button>
      ) : null}
      {singleTicket ? (
        <Button
          size="xs"
          variant={ticketsActive ? "secondary" : "ghost"}
          title={singleTicket.title}
          onClick={() => props.onNavigate(singleTicket.url)}
        >
          <TicketIcon />
          {singleTicket.identifier}
        </Button>
      ) : presentation.tickets.length > 1 ? (
        <Menu>
          <MenuTrigger
            render={
              <Button size="xs" variant={ticketsActive ? "secondary" : "ghost"}>
                <TicketIcon />
                Tickets ({presentation.tickets.length})
                <ChevronDownIcon />
              </Button>
            }
          />
          <MenuPopup align="start" className="w-72">
            {presentation.tickets.map((ticket) => (
              <MenuItem key={ticket.id} onClick={() => props.onNavigate(ticket.url)}>
                <TicketIcon />
                <span className="min-w-0">
                  <span className="block font-medium">{ticket.identifier}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {ticket.title}
                  </span>
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : (
        <span className="truncate px-1 text-xs text-muted-foreground">
          {presentation.ticketLookup === "loading"
            ? "Finding ticket…"
            : presentation.ticketLookup === "ready"
              ? "No linked ticket"
              : "Ticket unavailable"}
        </span>
      )}
    </div>
  );
}
