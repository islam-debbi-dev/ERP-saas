# M0 inventory of the imported app

The app was copied from a consumer delivery app (package `orvynt_starter`).
Phase 39 keeps its theme, design system and architecture and replaces the
business. This is what M0 does with each part (status at the start of M0).

## Kept (reused as is or lightly adapted)

| Area | Files |
|---|---|
| Design system | `core/design/*` (spacing, text styles, theme builder, `app_widgets`, responsive, theme colors), `core/theme/*` (light / dark, theme cubit) |
| Components | `core/components/widgets/*` (buttons, text field, shimmer, net image, staggered entrance) |
| Shell | `features/main_screen/ui/widgets/custom_bottom_navigation.dart`, `no_connection_banner.dart` |
| Reusable business widgets (moved to `core/components/` for M1) | `qty_stepper`, `floating_cart_bar`, `order_summary`, `search_input`, `pressable_card`, `load_state_view`, `order_status_chip` |
| Plumbing | `core/di`, `core/paging/*`, `core/perf`, `core/localization/*` (loader, `context.tr`, locale cubit), `core/network/token_storage.dart`, connectivity helpers, `bloc_observer`, `url_helper`, `phone_validate`, `format_date`, `core/models/{paginated,json_readers,geo_point}` |
| Fonts | Almarai (UI), PoiretOne / RussoOne (kept for now) |

## Replaced (same place, ERP contract)

| What | Why |
|---|---|
| `core/network/api_client.dart`, `auth_interceptor.dart`, `core/service/dio_generate.dart` | the ERP API has no `{ data }` envelope; native header, `Accept-Language`, refresh body |
| `core/service/api_error_handler.dart`, `api_error_model.dart`, `core/helpers/api_error_text.dart`, `error_handler.dart` | errors are `{ code, message, details }` with `ErrorCode` |
| `core/models/auth_user.dart`, `features/auth/data/repo/auth_repository.dart` | `AuthUser` of `GET /auth/me` (role, permissions, features...) |
| `core/session/*` | field roles, MOBILE_APP, forced password change, refusals; no guest |
| `core/router/*` | role shell from a `RoleScreens` table |
| `core/helpers/money.dart`, `format_price.dart` | `Decimal`, never `num`, for money and quantities |
| `core/config/app_env.dart`, `.env.example` | ERP keys only |
| `core/localization/{ar,fr,en}.json` | consumer keys out, ERP keys in, identical keys |
| Logo widgets, launcher icons, splash | neutral "Debvora" placeholder |

## Deleted (no use in a field ERP app)

- Features: `catalog` (stores, dishes, customizer), `cart` logic and screen,
  `checkout`, `order` (consumer orders), `home` feed, `onboarding` (stories,
  welcome), `account` addresses and location picker, guest mode, register,
  social login, forgot password.
- Core: `core/cities` (wilaya / commune picker), `core/service/background_uploader`,
  `core/config/category_groups.dart`, `guest_guard`, `showcase_keys`,
  image helpers bound to the old API, the old logo widgets.
- Assets: the old logos, social media icons, onboarding images.
- Tests and probes bound to those features: `test/features/{catalog,cart,checkout,home}`,
  `integration_test/zz_*`, `home_feed_scroll_perf_test`, `test_driver/perf_driver.dart`,
  `test_cities.dart`, the consumer JSON fixtures.

Each deletion lands in the commit of the step that replaces it.
