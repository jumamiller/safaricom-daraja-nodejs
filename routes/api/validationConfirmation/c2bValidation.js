var express = require('express')
var c2bValidationRouter = express.Router()
var moment = require('moment')

var mpesaFunctions = require('../../helpers/mpesaFunctions')
var C2BTransaction = require('./c2bTransactionModel')
var CallbackURLModel = require('./c2bCallbackUrlModel')
const GENERIC_SERVER_ERROR_CODE = '01'
const VALIDATION_TRANSACTION_ACTION_TYPE = 'validate'

/**
 * Send request to remote server for account number validation
 * @param req req.body contains request details from Safaricom
 * @param res
 * @param next
 */
var validateRequest = function (req, res, next) {
    //Check request validity
    if (!req.body)
        mpesaFunctions.handleError(res, 'Invalid request received', GENERIC_SERVER_ERROR_CODE)

    //Package request
    var validationReq = {
        transactionType: req.body.TransactionType,
        action: VALIDATION_TRANSACTION_ACTION_TYPE,
        phone: req.body.MSISDN,
        firstName: req.body.FirstName,
        middleName: req.body.MiddleName,
        lastName: req.body.LastName,
        amount: req.body.TransAmount,
        accountNumber: req.body.BillRefNumber,
        time: moment(moment(req.body.TransTime, "YYYYMMDDHHmmss")).format('YYYY-MM-DD HH:mm:ss')
    }

    //Find remote URL configuration from database
    CallbackURLModel.findOne({
        'shortCode': req.body.BusinessShortCode
    }, function (err, remoteEndPoints) {
        // Invalid database response
        if (!req.body)
            mpesaFunctions.handleError(res, 'Pay bill ' + req.body.BusinessShortCode + ' remote URLs not registered', GENERIC_SERVER_ERROR_CODE)

        // Short code remote end points not found
        if (!remoteEndPoints)
            mpesaFunctions.handleError(res, 'Remote end points for ' + req.body.BusinessShortCode + ' not found.', GENERIC_SERVER_ERROR_CODE)

        //Forward to remote server
        mpesaFunctions.sendCallbackMpesaTxnToAPIInitiator({
            url: remoteEndPoints.merchant.confirmation,
            transaction: validationReq
        }, req, res, next)
    })
}

/**
 * Save transaction details to db
 * @param req
 * @param res
 * @param next
 */
var saveTransaction = function (req, res, next) {
    var transaction = new C2BTransaction({
        validation: req.body,
        validationResult: req.transactionResp
    })

//   persist transaction details
    transaction.save(function (err) {
        if (err) mpesaFunctions.handleError(req, 'Unable to save validation request.', GENERIC_SERVER_ERROR_CODE)

        console.log('C2B: Validation transaction saved...')
        next();
    })
}

/**
 * Process response from remote merchant API
 * @param req req.transactionResp contains the response from the merchant
 * @param res
 * @param next
 */
function processRemoteValidationResp(req, res, next) {
    //Check response validity
    if (!req.transactionResp) mpesaFunctions.handleError(req, 'Validating account reference request failed.', GENERIC_SERVER_ERROR_CODE)

    // Design response to safaricom
    req.body.safaricomResp = {
        ResultCode: req.transactionResp.status === '00' ? 0 : 1,
        ResultDesc: req.transactionResp.message,
        ThirdPartyTransID: req.transactionResp.transactionId
    }
}

c2bValidationRouter.post('/',
    validateRequest,
    processRemoteValidationResp,
    saveTransaction,
    function (req, res, next) {
        res.json(req.body.safaricomResp)
    })


module.exports = c2bValidationRouter