import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Home() {
  const { authenticated, isAdmin } = useAuth();
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {authenticated && isAdmin ? (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-2">Create Item</h2>
          <p className="mb-4">
            Create a new item and receive an initial secret.
          </p>
          <Link to="/create" className="btn">
            Create
          </Link>
        </div>
      ) : null}
      <div className="card p-6">
        <h2 className="text-xl font-semibold mb-2">Register Asset</h2>
        <p className="mb-4">
          Transfer ownership using the seller's secret and get your private sale
          document.
        </p>
        <Link to="/register" className="btn">
          Register
        </Link>
      </div>
      <div className="card p-6">
        <h2 className="text-xl font-semibold mb-2">Verify</h2>
        <p className="mb-4">
          Look up any SKU+Serial registration chain and contest if necessary.
        </p>
        <Link to="/verify" className="btn">
          Verify
        </Link>
      </div>
    </div>
  );
}
