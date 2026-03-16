import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, Filler, Tooltip, Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useMemo } from "react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export default function PortfolioChart({ trades, initialBalance }) {
  const { labels, balances, pnls } = useMemo(() => {
    const sorted = [...trades]
      .filter(t => t.closedAt && t.pnl !== null)
      .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));

    let running = initialBalance;
    const labels   = [];
    const balances = [initialBalance];
    const pnls     = [0];

    sorted.forEach(t => {
      running += t.pnl;
      labels.push(
        new Date(t.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
      balances.push(parseFloat(running.toFixed(2)));
      pnls.push(parseFloat((running - initialBalance).toFixed(4)));
    });

    return { labels: ["Start", ...labels], balances, pnls };
  }, [trades, initialBalance]);

  const gradient = (ctx) => {
    const chart = ctx.chart;
    const { top, bottom } = chart.chartArea || {};
    const g = chart.ctx.createLinearGradient(0, top ?? 0, 0, bottom ?? 300);
    g.addColorStop(0,   "rgba(63,185,80,0.25)");
    g.addColorStop(1,   "rgba(63,185,80,0.00)");
    return g;
  };

  const data = {
    labels,
    datasets: [
      {
        label:           "Balance ($)",
        data:            balances,
        borderColor:     "#3fb950",
        backgroundColor: gradient,
        borderWidth:     2,
        pointRadius:     balances.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        tension:         0.3,
        fill:            true,
        yAxisID:         "y",
      },
      {
        label:       "Cum. P&L ($)",
        data:        pnls,
        borderColor: "#bc8cff",
        borderWidth: 1.5,
        borderDash:  [4, 4],
        pointRadius: 0,
        tension:     0.3,
        fill:        false,
        yAxisID:     "y2",
      },
    ],
  };

  const options = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#8b949e", font: { size: 11 } } },
      tooltip: {
        backgroundColor: "#161b22",
        borderColor:     "#30363d",
        borderWidth:     1,
        titleColor:      "#c9d1d9",
        bodyColor:       "#8b949e",
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: $${ctx.parsed.y.toFixed(4)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#8b949e", maxTicksLimit: 8, font: { size: 10 } },
        grid:  { color: "#21262d" },
      },
      y: {
        position: "left",
        ticks:    { color: "#3fb950", font: { size: 10 }, callback: v => "$" + v.toFixed(2) },
        grid:     { color: "#21262d" },
      },
      y2: {
        position: "right",
        ticks:    { color: "#bc8cff", font: { size: 10 }, callback: v => "$" + v.toFixed(4) },
        grid:     { drawOnChartArea: false },
      },
    },
  };

  return (
    <div className="card chart-card">
      <div className="card-lbl">Portfolio Equity Curve</div>
      <div style={{ height: 240, position: "relative" }}>
        {trades.length === 0
          ? <div className="empty-msg">No closed trades yet</div>
          : <Line data={data} options={options} />
        }
      </div>
    </div>
  );
}
