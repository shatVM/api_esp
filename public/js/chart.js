document.addEventListener('DOMContentLoaded', () => {
    const ctx = document.getElementById('sensorChart').getContext('2d');
    let chart;
    let allData = [];

    const chartConfig = {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Температура (°C)',
                    data: [],
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    hidden: false,
                },
                {
                    label: 'Вологість (%)',
                    data: [],
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    hidden: false,
                },
                {
                    label: 'Освітленість (lux)',
                    data: [],
                    borderColor: 'rgba(255, 206, 86, 1)',
                    backgroundColor: 'rgba(255, 206, 86, 0.2)',
                    hidden: false,
                },
                {
                    label: 'Батарея (V)',
                    data: [],
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    hidden: false,
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false // Disable default legend
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Час'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Значення'
                    }
                }
            }
        }
    };

    async function fetchData() {
        try {
            const response = await fetch('/api/history');
            allData = await response.json();
            updateChart();
        } catch (error) {
            console.error('Failed to fetch history data:', error);
        }
    }

    function updateChart() {
        const dataPoints = parseInt(document.getElementById('dataPoints').value, 10);
        const slicedData = allData.slice(-dataPoints);

        if (chart) {
            chart.data.labels = slicedData.map(d => new Date(d.timestamp).toLocaleTimeString());
            chart.data.datasets[0].data = slicedData.map(d => d.temperature_dht_c);
            chart.data.datasets[1].data = slicedData.map(d => d.humidity_dht_pct);
            chart.data.datasets[2].data = slicedData.map(d => d.lux);
            chart.data.datasets[3].data = slicedData.map(d => d.battery_v);
            chart.update();
        } else {
            chartConfig.data.labels = slicedData.map(d => new Date(d.timestamp).toLocaleTimeString());
            chartConfig.data.datasets[0].data = slicedData.map(d => d.temperature_dht_c);
            chartConfig.data.datasets[1].data = slicedData.map(d => d.humidity_dht_pct);
            chartConfig.data.datasets[2].data = slicedData.map(d => d.lux);
            chartConfig.data.datasets[3].data = slicedData.map(d => d.battery_v);
            chart = new Chart(ctx, chartConfig);
        }
    }

    const dataPointsSlider = document.getElementById('dataPoints');
    const dataPointsValue = document.getElementById('dataPointsValue');

    dataPointsSlider.addEventListener('input', (event) => {
        dataPointsValue.textContent = event.target.value;
        updateChart();
    });

    document.querySelectorAll('.sensor-item').forEach(item => {
        item.addEventListener('click', () => {
            const datasetIndex = item.getAttribute('data-dataset-index');
            if (chart) {
                const meta = chart.getDatasetMeta(datasetIndex);
                meta.hidden = !meta.hidden;
                item.classList.toggle('disabled');
                chart.update();
            }
        });
    });

    fetchData();
});