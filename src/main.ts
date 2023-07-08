import { SecretNetworkClient } from "secretjs";
import { UnbondingDelegationEntry } from "secretjs/dist/grpc_gateway/cosmos/staking/v1beta1/staking.pb";
import { createCanvas } from "canvas";
import { Chart, ChartItem, registerables } from "chart.js";
import fs from "fs";
import "dotenv/config";

Chart.register(...registerables);
Chart.defaults.color = "white";
Chart.defaults.font.weight = "500";

const plugin = {
  id: "customCanvasBackgroundColor",
  //@ts-ignore
  beforeDraw: (chart, args, options) => {
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = options.color || "#ffffff";
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
};

export const sleep = () => new Promise((resolve) => setTimeout(resolve, 2000));

async function getTotalUnbonding() {
  const startTime = performance.now();

  const client = new SecretNetworkClient({
    url: "https://lcd.secret.express",
    chainId: "secret-4",
  });
  console.log(`Initialized read-only client.`);

  const response = await client.query.staking.validators({
    // status: "BOND_STATUS_BONDED",
    pagination: {
      limit: "300",
    },
  });
  const validators = response.validators!;
  console.log(`Total Validators: ${validators.length}`);

  const operatorAddresses: string[] = [];
  const validator_names: string[] = [];
  const unbondingResponsesByValidator = new Map<
    string,
    UnbondingDelegationEntry[]
  >();
  let totalUnbonding = 0;

  try {
    for (let i = 0; i < validators.length; i++) {
      const validatorName = validators[i].description?.moniker!;
      validator_names.push(validatorName);

      const validator_address = validators[i].operator_address!;
      operatorAddresses.push(validator_address);

      const unbondings =
        await client.query.staking.validatorUnbondingDelegations({
          validator_addr: validator_address,
          pagination: { limit: "1000" },
        });

      if (unbondings.unbonding_responses?.length! > 0) {
        const entriesArray = unbondings.unbonding_responses!.flatMap(
          (response) => {
            return response.entries!.map(({ completion_time, balance }) => ({
              completion_time,
              balance,
            }));
          }
        );
        unbondingResponsesByValidator.set(validatorName, entriesArray);
      }
    }

    for (const [
      validatorName,
      unbondingResponses,
    ] of unbondingResponsesByValidator.entries()) {
      const balance = unbondingResponses.reduce(
        (sum: number, entry: UnbondingDelegationEntry) => {
          const entryBalance = parseInt(entry.balance!);
          return sum + entryBalance;
        },
        0
      );

      totalUnbonding += balance;

      console.log();
      console.log(
        validatorName,
        Math.floor(balance / 1000000).toLocaleString()
      );
      console.log("Unbonding Responses:", unbondingResponses.length);
    }

    console.log(
      "\nTotal:",
      Math.floor(totalUnbonding / 1000000).toLocaleString(),
      "SCRT"
    );
    console.log("Validators: ", operatorAddresses.length);
  } catch (error) {
    throw new Error(`Error:\n ${JSON.stringify(error, null, 4)}`);
  }

  // Convert the map to a plain object
  const unbondingResponsesObject = Object.fromEntries(
    unbondingResponsesByValidator
  );

  // Convert the object to a JSON string
  const jsonData = JSON.stringify(unbondingResponsesObject, null, 2);

  // Save the JSON string to a file
  fs.writeFileSync("unbonding.json", jsonData, "utf8");

  const endTime = performance.now();
  const totalTime = (endTime - startTime) / 1000;
  console.log("\nTotal time:", totalTime, "seconds");
}

async function createChart() {
  const { Chart } = await import("chart.js");

  // Set up the virtual canvas
  const width = 800; // Width of the canvas
  const height = 400; // Height of the canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as ChartItem;

  interface BalancesData {
    completion_time: string;
    balance: string;
  }

  interface GroupedData {
    date: string;
    balance: number;
  }

  // Fetch the JSON file
  const filePath = "unbonding.json";
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const balancesData = JSON.parse(fileContent);

  const groupedData: GroupedData[] = Object.values(balancesData).flatMap(
    (entries: unknown) =>
      (entries as BalancesData[]).map(({ completion_time, balance }) => ({
        date: new Date(completion_time).toLocaleDateString(),
        balance: parseInt(balance) / 1000000,
      }))
  );

  // Group balances by date
  const groupedByDate: Record<string, number[]> = groupedData.reduce(
    (groups: Record<string, number[]>, { date, balance }) => {
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(balance);
      return groups;
    },
    {}
  );

  // Sort the grouped data by date
  const sortedData: [string, number[]][] = Object.entries(groupedByDate).sort(
    ([dateA], [dateB]) => {
      const date1 = new Date(dateA).getTime();
      const date2 = new Date(dateB).getTime();
      return date1 - date2;
    }
  );

  // Extract the dates and balances
  const labels: string[] = sortedData.map(([date]) => {
    const dateObj = new Date(date);
    const day = dateObj.getDate().toString().padStart(2, "0");
    const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
    return `${month}/${day}`;
  });

  const datasets = [
    {
      label: "SCRT",
      data: sortedData.map(([_, balances]) =>
        balances.reduce((sum, balance) => sum + balance, 0)
      ),
      backgroundColor: "rgba(0, 123, 255, 0.5)",
      borderColor: "rgba(0, 123, 255, 1)",
      borderWidth: 1,
    },
  ];

  const totalUnbonding = datasets[0].data.reduce(
    (sum, balance) => sum + balance,
    0
  );

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: datasets,
    },
    options: {
      layout: {
        padding: {
          top: 5,
          bottom: 20,
          left: 20,
          right: 20,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              size: 16,
            },
          },
          grid: {
            color: "#1f1f1f",
          },
        },
        x: {
          grid: {
            color: "#1f1f1f",
          },
        },
      },
      plugins: {
        //@ts-ignore
        customCanvasBackgroundColor: {
          color: "#2d2e2f",
        },
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: "SCRT Unbonding",
          font: {
            size: 24,
          },
          padding: {
            top: 10,
            bottom: 0,
          },
        },
        subtitle: {
          display: true,
          text: `Total: ${Math.round(totalUnbonding).toLocaleString()} SCRT`,
          font: {
            size: 16,
          },
          padding: {
            bottom: 10,
          },
        },
      },
    },
    plugins: [plugin],
  });

  // Render the chart to an image file
  const outputFile = "chart.png";
  const imageBuffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outputFile, imageBuffer);

  console.log(`Chart saved as ${outputFile}`);
}

(async () => {
  await getTotalUnbonding();
  await createChart();
})();
