import { runViewCleanups } from "../../utils/viewLifecycle";

export type LegacyViewMount = (container: HTMLElement) => void | Promise<void>;

export function wrapLegacyView(
  mount: LegacyViewMount,
): (container: HTMLElement) => void | Promise<() => void> {
  return (container) => {
    const result = mount(container);
    if (result && typeof (result as PromiseLike<void>).then === "function") {
      return (result as PromiseLike<void>).then(() => () => {
        runViewCleanups(container);
        container.replaceChildren();
      });
    }
    return () => {
      runViewCleanups(container);
      container.replaceChildren();
    };
  };
}
