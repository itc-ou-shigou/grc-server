import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

type ChartType = 'line' | 'bar' | 'pie';

interface SeriesConfig {
  key: string;
  label?: string;
  color?: string;
}

interface ChartProps {
  type: ChartType;
  data: Record<string, unknown>[];
  xKey?: string;
  yKey?: string | SeriesConfig[];
  title?: string;
  height?: number;
  colors?: string[];
  nameKey?: string;
  valueKey?: string;
}

const DEFAULT_COLORS = [
  '#4361ee',
  '#3a86ff',
  '#ff006e',
  '#fb5607',
  '#ffbe0b',
  '#8338ec',
  '#06d6a0',
  '#118ab2',
];

export function Chart({
  type,
  data,
  xKey = 'name',
  yKey = 'value',
  title,
  height = 280,
  colors = DEFAULT_COLORS,
  nameKey = 'name',
  valueKey = 'value',
}: ChartProps) {
  const series: SeriesConfig[] = Array.isArray(yKey)
    ? yKey
    : [{ key: yKey as string, color: colors[0] }];

  return (
    <div className="chart-container">
      {title && <div className="chart-title">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label ?? s.key}
                stroke={s.color ?? colors[i % colors.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : type === 'bar' ? (
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label ?? s.key}
                fill={s.color ?? colors[i % colors.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        ) : (
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={Math.min(height / 2 - 20, 100)}
              dataKey={valueKey}
              nameKey={nameKey}
              label={({ name, percent }: { name: string; percent: number }) =>
                `${name} ${(percent * 100).toFixed(0)}%`
              }
              labelLine={false}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
