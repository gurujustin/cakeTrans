const ethers = require('ethers');
const {ChainId, Token, TokenAmount, Fetcher, Pair, Route, Trade, TradeType, Percent} = require('@pancakeswap-libs/sdk');
const axios = require('axios');
const Web3 = require('web3');
const {JsonRpcProvider} = require("@ethersproject/providers");
var express = require('express');
const ip = require('request-ip');
require("dotenv").config();

app = express();

const provider = new JsonRpcProvider('https://bsc-dataseed.binance.org/');
const web3 = new Web3('wss://apis.ankr.com/wss/c40792ffe3514537be9fb4109b32d257/946dd909d324e5a6caa2b72ba75c5799/binance/full/main');
const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);


console.log(`Modulos cargados`);

app.get('/swap/:inputToken/:outputToken/:inputTokenAmount/:Slipage/:Pancake_Router', function(req, res) {
	const InputTokenAddr = web3.utils.toChecksumAddress(req.params.inputToken);
	const OutputTokenAddr = web3.utils.toChecksumAddress(req.params.outputToken);
	const InputTokenAmount = req.params.inputTokenAmount;
	const Slipage = req.params.Slipage;
	const PANCAKE_ROUTER = req.params.Pancake_Router;

	// 1/1000 = 0.001
	const ONE_ETH_IN_WEI = web3.utils.toBN(web3.utils.toWei('1'));//BN->(BIG NUMBER) || toWei -> Converts any ether value value into wei.
	const tradeAmount = ONE_ETH_IN_WEI.div(web3.utils.toBN('1000'));//tradeAmount = ONE_ETH_IN_WEI/1000

	console.log(`tradeAmount ` + tradeAmount );

	const init = async () => {

		const [INPUT_TOKEN, OUTPUT_TOKEN] = await Promise.all(
			[InputTokenAddr, OutputTokenAddr].map(tokenAddress => (
				new Token(
					ChainId.MAINNET,
					tokenAddress,
					18
				)
			)));

		console.log(` <<<<<------- pair-------->>>>>`);
		const pair = await Fetcher.fetchPairData(INPUT_TOKEN, OUTPUT_TOKEN, provider);
		//console.log(JSON.stringify(pair));
		console.log(` <<<<<------- route-------->>>>>`);
		const route = await new Route([pair], INPUT_TOKEN);
		//console.log(JSON.stringify(route));
		console.log(` <<<<<------- Trade-------->>>>>`);
		const trade = await new Trade(route, new TokenAmount(INPUT_TOKEN, tradeAmount), TradeType.EXACT_INPUT);
		//console.log(JSON.stringify(trade));

		const slippageTolerance = new Percent(Slipage, '100'); // 
		console.log("slippageTolerance: " + JSON.stringify(slippageTolerance));


		// create transaction parameters
		const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
		const path = [INPUT_TOKEN.address, OUTPUT_TOKEN.address];
		const to = admin;
		const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

		// Create signer
		const wallet = new ethers.Wallet(
			Buffer.from(
			process.env.PRIVATE_KEY, 
			"hex"
			)
		);
		const signer = wallet.connect(provider);

		// Create Pancakeswap ethers Contract
		const pancakeswap = new ethers.Contract(
			PANCAKE_ROUTER,
			['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'],
			signer
		);
		
		var date = new Date();  // date of today
		console.log(date);

		var gasPrice = 10; // default value of gasPrice
		let data = JSON.stringify({
		query: `query ($network: EthereumNetwork!,
						$dateFormat: String!,

						$from: ISO8601DateTime,
						$till: ISO8601DateTime){
							ethereum(network: $network ){
							transactions(options:{asc: "date.date"}, date: {
								since: $from
								till: $till}

							) {
								date: date{
								date(format: $dateFormat)
								}
								gasPrice
								gasValue
								average: gasValue(calculate: average )
								maxGasPrice: gasPrice(calculate: maximum)
								medianGasPrice: gasPrice(calculate: median)
							}
							}
						}`,
		variables: {"limit":10,"offset":0,"network":"bsc","from":date,"till":date,"dateFormat":"%Y-%m-%d"}
		});

		let config = {
			method: 'post',
			url: 'https://graphql.bitquery.io',
			headers: { 
				'Content-Type': 'application/json'
			},
			data : data
		};

		await axios(config)
		.then((response) => {
			console.log(JSON.stringify(response.data.data.ethereum.transactions[0].medianGasPrice));
			gasPrice = response.data.data.ethereum.transactions[0].medianGasPrice + 2; // gasPrice of today = medianGasPrice + 2
		})
		.catch((error) => {
			console.log(error);
		});

		
		//Allow input token

		console.log(`Allow Pancakeswap <<<<<------- START-------->>>>>`);
		let abi = ["function approve(address _spender, uint256 _value) public returns (bool success)"];
		let contract = new ethers.Contract(INPUT_TOKEN.address, abi, signer);
		let aproveResponse = await contract.approve(PANCAKE_ROUTER, ethers.utils.parseUnits('1000.0', 18), {gasLimit: 100000, gasPrice: ethers.utils.parseUnits(gasPrice.toString(), "gwei")});
		console.log(JSON.stringify(aproveResponse));
		console.log(`Allow Pancakeswap <<<<<------- END-------->>>>>`);


		// swap token
		console.log(`Ejecutando transaccion`);		
		var amountInParam = ethers.utils.parseUnits(InputTokenAmount, 18);
		var amountOutMinParam = ethers.utils.parseUnits(web3.utils.fromWei(amountOutMin.toString()), 18);
		
		console.log("amountInParam: " + amountInParam);
		console.log("amountOutMinParam: " + amountOutMinParam);
		console.log("amountOutMin: " + amountOutMin);
		
		const tx = await pancakeswap.swapExactTokensForTokens(
			amountInParam,
			amountOutMinParam,
			path,
			to,
			deadline,
			{ gasLimit: ethers.utils.hexlify(300000), gasPrice: ethers.utils.parseUnits(gasPrice.toString(), "gwei") }
		);

		console.log(`Tx-hash: ${tx.hash}`)

		try {
			const receipt = await tx.wait();
			console.log(`Tx was mined in block: ${receipt.blockNumber}`);

			json_res = {
				hash: tx.hash,
				isSuccess: true
			}
		} catch(e) {
			console.log(e);
			json_res = {
				hash: tx.hash,
				isSuccess: false
			}
		}
		res.json(json_res);
	}

	// call init function if only call from localhost
	if (ip.getClientIp(req) == `127.0.0.1` || ip.getClientIp(req) == `::1`) {
		init();
	}
});

var server = app.listen(8081, function() {
	var host = server.address().address;
	var port = server.address().port;
	console.log("server is running at http://%s:%s", host, port);
});