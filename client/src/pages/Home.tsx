import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  CubeIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassCircleIcon,
} from "@heroicons/react/24/outline";

export default function Home() {
  const { authenticated, isAdmin } = useAuth();
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {authenticated && isAdmin ? (
        <div className="card p-6 transition-all hover:-translate-y-1 hover:border-autumn-300">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-autumn-100 text-autumn-700">
            <CubeIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold mb-1 text-slate-800">Create Item</h2>
          <p className="mb-4 muted">
            Create a new item and receive an initial secret.
          </p>
          <Link to="/create" className="btn">
            Create
          </Link>
        </div>
      ) : null}
      <div className="card p-6 transition-all hover:-translate-y-1 hover:border-autumn-300">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-autumn-100 text-autumn-700">
          <ClipboardDocumentCheckIcon className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold mb-1 text-slate-800">Register Asset</h2>
        <p className="mb-4 muted">
          Transfer ownership using the seller's secret and get your private sale
          document.
        </p>
        <Link to="/register" className="btn">
          Register
        </Link>
      </div>
      <div className="card p-6 transition-all hover:-translate-y-1 hover:border-autumn-300">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-autumn-100 text-autumn-700">
          <MagnifyingGlassCircleIcon className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold mb-1 text-slate-800">Verify</h2>
        <p className="mb-4 muted">
          Look up any SKU+Serial registration chain and contest if necessary.
        </p>
        <Link to="/verify" className="btn">
          Verify
        </Link>
      </div>
    </div>
  );
}
