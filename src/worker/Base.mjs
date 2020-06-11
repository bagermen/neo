import {default as CoreBase} from '../core/Base.mjs';
import Observable            from '../core/Observable.mjs';
import Message               from './Message.mjs';
import RemoteMethodAccess    from './mixins/RemoteMethodAccess.mjs';

/**
 * The abstract base class for the App, Data & VDom worker
 * @class Neo.worker.Base
 * @extends Neo.core.Base
 * @abstract
 */
class Base extends CoreBase {
    static getConfig() {return {
        /**
         * @member {String} className='Neo.worker.Worker'
         * @private
         */
        className: 'Neo.worker.Worker',
        /**
         * @member {String} ntype='worker'
         * @private
         */
        ntype: 'worker',
        /**
         * Only needed for SharedWorkers
         * @member {Boolean} isConnected=false
         * @private
         */
        isConnected: false,
        /**
         * @member {Boolean} isSharedWorker=false
         * @private
         */
        isSharedWorker: false,
        /**
         * @member {String[]|Neo.core.Base[]|null} mixins=[Observable, RemoteMethodAccess]
         */
        mixins: [Observable, RemoteMethodAccess],
        /**
         * Only needed for SharedWorkers
         * @member {Object|null} ports=null
         */
        ports : null,
        /**
         * @member {String|null} workerId=null
         * @private
         */
        workerId: null
    }}

    /**
     *
     * @param {Object} config={}
     */
    constructor(config={}) {
        super(config);

        let me = this;

        Object.assign(me, {
            isSharedWorker: self.toString() === '[object SharedWorkerGlobalScope]',
            ports         : {},
            promises      : {}
        });

        if (me.isSharedWorker) {
            self.onconnect = me.onConnected.bind(me);
        } else {
            self.onmessage = me.onMessage.bind(me);
        }

        Neo.workerId      = me.workerId;
        Neo.currentWorker = me;
    }

    /**
     *
     * @param {String} appName
     * @return {MessagePort|null}
     */
    getPort(appName) {
        Object.entries(this.ports).forEach(([key, value]) => {
            if (value.appName === appName) {
                return value.port;
            }
        });

        return null;
    }

    /**
     *
     */
    onConstructed() {
        super.onConstructed();

        if (!this.isSharedWorker) {
            this.sendMessage('main', {action: 'workerConstructed'});
        }
    }

    /**
     * Only relevant for SharedWorkers
     * @param {Object} e
     */
    onConnected(e) {console.log('onConnected');
        let me = this,
            id = Neo.getId('port');

        me.isConnected = true;

        me.ports[id] = {
            app : null,
            port: e.ports[0]
        };

        me.ports[id].port.onmessage = me.onMessage.bind(me);

        me.fire('connected');

        // todo: find a better way to ensure the remotes are registered before triggering workerConstructed
        setTimeout(() => {
            me.sendMessage('main', {action: 'workerConstructed', port: id});
        }, 100);
    }

    /**
     * Only relevant for SharedWorkers
     */
    onDisconnect() {
        console.log('worker.Base: onDisconnect');
    }

    /**
     *
     * @param {Object} e
     */
    onMessage(e) {
        let me      = this,
            data    = e.data,
            action  = data.action,
            replyId = data.replyId,
            promise;

        if (!action) {
            throw new Error('Message action is missing: ' + data.id);
        }

        if (action !== 'reply') {
            try {
                this['on' + Neo.capitalize(action)](data);
            } catch(err) {
                console.log('error', data, err, e);

                this.reject(data.id, {
                    error : err.message
                });
            }
        } else if (promise = action === 'reply' && me.promises[replyId]) {
            if (data.reject) {
                promise.reject(data.data);
            } else {
                promise.resolve(data.data);
            }

            delete me.promises[replyId];
        }
    }

    /**
     *
     * @param {Object} msg
     */
    onPing(msg) {
        this.resolve(msg, {
            originMsg: msg
        });
    }

    /**
     *
     * @param {Object} msg
     */
    onRegisterNeoConfig(msg) {
        Neo.config = Neo.config || {};
        Object.assign(Neo.config, msg.data);
    }

    /**
     *
     * @param {String} dest app, data, main or vdom (excluding the current worker)
     * @param {Object} opts configs for Neo.worker.Message
     * @param {Array} [transfer] An optional array of Transferable objects to transfer ownership of.
     * If the ownership of an object is transferred, it becomes unusable (neutered) in the context it was sent from
     * and becomes available only to the worker it was sent to.
     * @returns {Promise<any>}
     */
    promiseMessage(dest, opts, transfer) {
        let me = this;

        return new Promise(function(resolve, reject) {
            let message = me.sendMessage(dest, opts, transfer),
                msgId   = message.id;

            me.promises[msgId] = {
                resolve: resolve,
                reject : reject
            };
        });
    }

    /**
     * Only needed for SharedWorkers
     * @param {String} name
     */
    registerApp(name) {
        Object.entries(this.ports).forEach(([key, value]) => {
            if (!value.app) {
                this.ports[key].app = name;
            }
        });
    }

    registerMainView(name) {
        Object.entries(this.ports).forEach(([key, value]) => {
            if (value.app !== name) {
                Neo.apps[value.app].mainViewInstance.fire('connect', name);
            }
        });
    }

    /**
     * @param {String} dest app, data, main or vdom (excluding the current worker)
     * @param {Object} opts configs for Neo.worker.Message
     * @param {Array} [transfer] An optional array of Transferable objects to transfer ownership of.
     * If the ownership of an object is transferred, it becomes unusable (neutered) in the context it was sent from
     * and becomes available only to the worker it was sent to.
     * @returns {Neo.worker.Message}
     * @private
     */
    sendMessage(dest, opts, transfer) {
        opts.destination = dest;

        let me = this,
            message, port;

        if (!me.isSharedWorker) {
            port = self;
        } else {
            if (opts.port) {
                port = me.ports[opts.port].port;
            }else if (opts.appName) {
                port = me.getPort(opts.appName);
                // todo: add the port id to opts
            } else {
                port = me.ports[Object.keys(me.ports)[0]].port;
            }
        }

        message = new Message(opts);

        port.postMessage(message, transfer);
        return message;
    }
}

Neo.applyClassConfig(Base);

export {Base as default};