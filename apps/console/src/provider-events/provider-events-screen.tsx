import { useRef } from 'react';
import type { ConsoleProviderEventView, ProviderEventsState } from './provider-event-ui-types';

interface ProviderEventsScreenProps {
  state: ProviderEventsState;
  events: ConsoleProviderEventView[];
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  pageIndex: number;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

function receivedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function eventTypeLabel(type: ConsoleProviderEventView['type']): string {
  return type === 'payment' ? 'Payment' : 'Logistics';
}

function ProviderEventPager({
  placement,
  pageIndex,
  hasPreviousPage,
  hasNextPage,
  onPrevious,
  onNext,
}: {
  placement: 'top' | 'bottom';
  pageIndex: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="order-pager" aria-label={`Third-party log pages ${placement}`}>
      <p className="pager-range">Page {pageIndex + 1}</p>
      <div className="pager-actions">
        <button className="button" type="button" disabled={!hasPreviousPage} onClick={onPrevious}>Previous</button>
        <button className="button" type="button" disabled={!hasNextPage} onClick={onNext}>Next</button>
      </div>
    </nav>
  );
}

function ProviderEventBody({ event }: { event: ConsoleProviderEventView }) {
  return (
    <>
      <dl className="provider-event-fields">
        <div><dt>Event ID</dt><dd>{event.id}</dd></div>
        <div><dt>Provider</dt><dd>{event.provider}</dd></div>
        <div><dt>Provider event</dt><dd>{event.providerEventId}</dd></div>
        <div><dt>Received</dt><dd>{receivedAt(event.receivedAt)}</dd></div>
        <div><dt>Order</dt><dd>{event.order ? `${event.order.reference} · ${event.order.status}` : 'Unmatched'}</dd></div>
      </dl>
      <pre className="provider-event-payload" aria-label={`Raw ${event.provider} payload for ${event.providerEventId}`}>{event.payloadJson}</pre>
    </>
  );

}
export function ProviderEventsScreen({
  state,
  events,
  hasPreviousPage,
  hasNextPage,
  pageIndex,
  onRetry,
  onPreviousPage,
  onNextPage,
}: ProviderEventsScreenProps) {
  const resultsRef = useRef<HTMLElement>(null);
  const paging = state === 'ready' || state === 'no-results';
  const goToPage = (direction: 'previous' | 'next', placement: 'top' | 'bottom') => {
    if (direction === 'previous') onPreviousPage();
    else onNextPage();
    if (placement === 'bottom') resultsRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <p className="page-kicker">Provider operations · Nexus</p>
          <h1>Third-party logs</h1>
          <p>Immutable provider callbacks, including unmatched events, retained for operational review.</p>
        </div>
      </header>

      <section ref={resultsRef} className="data-region" aria-labelledby="provider-event-results-title" aria-busy={state === 'loading'}>
        <h2 id="provider-event-results-title" className="sr-only">Third-party log results</h2>
        <p className="sr-only" aria-live="polite">{state === 'ready' ? `Showing page ${pageIndex + 1} of third-party logs.` : ''}</p>
        {paging ? <ProviderEventPager placement="top" pageIndex={pageIndex} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onPrevious={() => goToPage('previous', 'top')} onNext={() => goToPage('next', 'top')} /> : null}

        {state === 'loading' ? (
          <div aria-label="Loading third-party logs">
            {[0, 1, 2].map((row) => <div className="skeleton-row provider-event-skeleton-row" key={row} aria-hidden="true">{[0, 1, 2].map((cell) => <span className="skeleton-line" key={cell} />)}</div>)}
          </div>
        ) : null}

        {state === 'error' ? (
          <div className="empty-state notice-error" role="alert">
            <h3>Third-party logs could not be loaded</h3>
            <p>Retry to request the immutable provider event feed again.</p>
            <button className="button" type="button" onClick={onRetry}>Retry loading logs</button>
          </div>
        ) : null}

        {state === 'empty' ? (
          <div className="empty-state">
            <h3>No third-party logs have been received.</h3>
            <p>Provider callbacks will appear here after they reach Nexus.</p>
          </div>
        ) : null}

        {state === 'no-results' ? (
          <div className="empty-state">
            <h3>No logs remain on this page.</h3>
            <p>The event feed changed. Return to the previous page to continue reviewing it.</p>
            <button className="button" type="button" onClick={onPreviousPage}>Previous page</button>
          </div>
        ) : null}

        {state === 'ready' ? (
          <>
            <table className="console-table provider-events-table">
              <thead><tr><th scope="col">Event</th><th scope="col">Provider</th><th scope="col">Received</th><th scope="col">Order</th><th scope="col">Raw payload</th></tr></thead>
              <tbody>{events.map((event) => (
                <tr key={event.id}>
                  <td><strong>{eventTypeLabel(event.type)}</strong><br /><span>{event.id}</span><br /><span>{event.providerEventId}</span></td>
                  <td>{event.provider}</td>
                  <td>{receivedAt(event.receivedAt)}</td>
                  <td>{event.order ? `${event.order.reference} · ${event.order.status}` : 'Unmatched'}</td>
                  <td><pre className="provider-event-payload">{event.payloadJson}</pre></td>
                </tr>
              ))}</tbody>
            </table>
            <ol className="provider-event-mobile provider-event-list">{events.map((event) => (
              <li key={event.id}>
                <header><strong>{eventTypeLabel(event.type)}</strong><span>{event.provider}</span></header>
                <ProviderEventBody event={event} />
              </li>
            ))}</ol>
          </>
        ) : null}

        {paging ? <ProviderEventPager placement="bottom" pageIndex={pageIndex} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onPrevious={() => goToPage('previous', 'bottom')} onNext={() => goToPage('next', 'bottom')} /> : null}
      </section>
    </div>
  );
}
