export default function ResultsTable({ columns, rows, emptyNode }) {
  if (!rows || !rows.length) {
    return emptyNode || <span className="note">0 rows returned.</span>;
  }
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table>
        <thead>
          <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} style={{ whiteSpace: 'nowrap' }}>
                  {v === true ? <span className="badge ok">TRUE</span>
                    : v === false ? <span className="badge no">FALSE</span>
                    : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
