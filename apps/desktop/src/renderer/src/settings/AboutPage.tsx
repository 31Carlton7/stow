import { useEffect, useRef, useState } from "react";
import { APP_NAME, type SystemInfo } from "@amc/contracts";
import { useDissolve } from "../components/ScrollFades";
import type { RpcClient } from "../rpc/client";

/**
 * About: which build is showing, and whose files it reads. The folder matters when a check points
 * the app at a fixture home: this is where that shows.
 */
export function AboutPage({ rpc, onShowWelcome }: { rpc: Pick<RpcClient, "call">; onShowWelcome: () => void }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  useEffect(() => {
    let live = true;
    // A server that cannot be reached is said by every list, which has nothing to show without it.
    rpc.call("system.info", {}).then((answered) => { if (live) setInfo(answered); }, () => {});
    return () => { live = false; };
  }, [rpc]);

  return (
    <section className="col models" aria-label="About">
      <div className="col-head" />
      <div className="models-scroll" ref={scroller}>
        <div className="models-page">
          <h1 className="lib-reader-title">About</h1>
          <p className="models-lede">{APP_NAME} reads your agents' files where they are kept and keeps only an index of its own.</p>
          {info !== null && (
            <dl className="look-card about">
              <div className="look-row">
                <dt className="look-name">Version</dt>
                <dd className="about-value">{info.version}</dd>
              </div>
              <div className="look-row">
                <dt className="look-name">Reading</dt>
                <dd className="about-value about-path" data-selectable>{info.sourceHome}</dd>
              </div>
            </dl>
          )}
          <div className="look-card about-welcome">
            <div className="look-row">
              <span className="look-name">Welcome</span>
              <button type="button" className="btn" onClick={onShowWelcome}>Show the welcome again</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
