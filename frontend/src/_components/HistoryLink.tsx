import Link from "next/link";

export default function HistoryLink({ id, pageName }: { id: string, pageName: string }) {
    return (
        <Link
            href={`/home/${pageName}/${id}/history`}
            className="inline-flex justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 shadow-xs ring-gray-300 ring-inset hover:bg-gray-50"
        >
            History
        </Link>
    )
}