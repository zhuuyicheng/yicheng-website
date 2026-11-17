/** Success envelope used by every `/api/v1` endpoint. See DESIGN.md §7.1. */
export interface DataResponseBody<T> {
  data: T;
}
