# Renfent

A local Next.js application for booking seat reservations against Renfe subscription passes (abonos). It uses the same website endpoints as venta.renfe.com, with a session cookie supplied manually by the user.

Built with Next.js 16, React 19, TypeScript, and Tailwind CSS 4. The HTTP client handles Renfe form requests and DWR replies on the server.

## Run locally

Install Node.js 20.9 or newer, then:

```bash
git clone https://github.com/ycrbt/renfent.git
cd renfent
npm ci
npm run dev
```

Open **http://localhost:3000**.

For a production build running locally:

```bash
npm run build
npm start
```

The build downloads the Geist font from Google Fonts and needs internet access.

## Book a reservation

1. Log in to [venta.renfe.com](https://venta.renfe.com) in your browser and open **Mis abonos**.
2. Open the browser developer tools → **Network**. Select a request to `venta.renfe.com` and copy the complete **Cookie** request-header value.
3. Paste it into Renfent and select **Verificar sesión**. A leading `Cookie:` prefix is accepted.
4. Select your abono. Passes that have not expired, including future passes, are shown as **Vigente**.
5. Select the route and travel dates. The calendar limits dates to the pass validity window. Presets are available for Valladolid ↔ Madrid-Chamartín; a custom route requires Renfe's exact station names and codes.
6. Choose a departure for each date. The dates keep their order while loading. Only one accordion opens at a time; departure lists scroll inside a fixed-height panel.
7. Continue to seat selection. Coaches and seat rows scroll horizontally. Both 2+3 and 2+2 layouts are supported, including numeric-only seat identifiers. H seats are excluded.
8. Select the seats to book, choose **Reservar**, and review **Confirmar reservas**.
9. Select **Confirmar y reservar** to create real Renfe reservations. The application checks seat availability again and shows a locator or an error for each date.

You can reserve a subset of the selected dates. Successful dates are protected against resubmission within the current screen. Check the reservation in Renfe's own website before retrying after a disconnected booking request: a reservation may have succeeded even if the response was lost.

Use **Reintentar** on an individual failed train or seat fetch. The **Inicio** header button clears the local cookie and selections and restarts the flow. It does not cancel reservations already created or sign you out of Renfe.

## Session and performance

Renfe cookies expire quickly. If the application reports an expired session, copy a fresh cookie from a logged-in Renfe tab and restart. The pasted cookie is a credential: do not share it or commit it to Git. Renfent stores it in this tab's `sessionStorage` and sends it to the local Next.js server; closing the session with **Inicio** or **Cerrar sesión** clears that local state.

Seat loading performs several Renfe requests per date, including payment-method retrieval required by Renfe's free-reservation form. Seat preparation and final booking run one date at a time because they use Renfe's current purchase session. Availability requests for coaches in the same map run in parallel. Train discovery also runs in parallel. Renfe may reject a request, show a waiting room, or respond slowly.

The app replays the journey before final booking so expired seat-page state is not reused. The originally selected seat may no longer be available. Different dates can succeed or fail independently.

This application is intended for local use. It is an unofficial integration with Renfe's website endpoints; changes to Renfe's forms or DWR responses may require updates. No automatic login, browser extension, or Python backend is required.

## Development

```bash
npm run dev
npm run lint
npx tsc --noEmit --incremental false
```

- `app/api/check-session`: validate the cookie and list passes.
- `app/api/list-trains`: stream departure options per date.
- `app/api/seat-map`: stream coach and seat availability.
- `app/api/book`: submit the selected seat and stream booking results.
- `lib/renfe.ts`: Renfe HTTP session and booking flow.
- `lib/dwr.ts`: DWR parsing and serialization.
- `components/`: date, cookie, header, and coach UI.
- `context/SessionContext.tsx`: local session and selection state.

Failed booking results are logged by the server. Cookies, local environment files, generated Next.js output, and dependencies are not included in the repository.
