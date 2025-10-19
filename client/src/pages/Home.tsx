import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="card p-6">
        <h2 className="text-xl font-semibold mb-2">Create Item</h2>
        <p className="mb-4">
          Register a new item, pay $5 (or free in FREEMODE), and receive an
          initial secret.
        </p>
        <Link to="/create" className="btn">
          Create
        </Link>
      </div>
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
