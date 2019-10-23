import {
    InanoSQLInstance,
    InanoSQLQueryAST,
    InanoSQLProcessedSort,
    InanoSQLUnionArgs,
    InanoSQLFunctionQuery,
    InanoSQLGraphArgs,
    InanoSQLJoinArgs,
    InanoSQLAdapter,
    InanoSQLWhereQuery,
    InanoSQLWhereStatement,
    InanoSQLDBConfig,
    InanoSQLIndex,
    InanoSQLWhereIndex,
    InanoSQLTableConfig, InanoSQLQueryActions, InanoSQLActions
} from "./interfaces";
import {objectsEqual, QueryArguments, resolvePath} from "./utilities";




export class QueryPrepare {

    /**
     * Builds an optimized list of actions for the query engine to perform.
     * 
     * Once the list is built, we can execute the query.
     * @static
     * @param {InanoSQLInstance} nSQL
     * @param {InanoSQLQueryAST} pQuery
     * @returns {InanoSQLQueryActions[]}
     * @memberof PrepareQuery
     */
    static prepare(nSQL: InanoSQLInstance, pQuery: InanoSQLQueryAST): InanoSQLQueryActions[] {

        const queryWillSelect = ["select", "upsert", "delete", "rebuild indexes", "conform rows", "clone"].indexOf(pQuery.action) !== -1;
        const isSelect = pQuery.action === "select";

        const queryProcess: {
            actions: InanoSQLQueryActions[];
            alreadyOrderBy: boolean;
            alreadyRange: boolean;
        } = queryWillSelect ? this.resolveSelectActions(nSQL, pQuery) : {actions: [], alreadyOrderBy: false, alreadyRange: false};

        if (queryWillSelect) {

            const hasAggregateFn: boolean = this.hasAggrFn(nSQL, pQuery);

            if (isSelect) {
                if (pQuery.union) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.union,
                        name: "Union",
                        args: pQuery.union
                    })
                }

                if (pQuery.graph) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.graph,
                        name: "Graph",
                        args: pQuery.graph
                    })
                }

                if (pQuery.join) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.join,
                        name: "Join",
                        args: pQuery.join
                    });
                }

                if (pQuery.groupBy) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.group,
                        name: "Group By",
                        args: {
                            groupBy: pQuery.groupBy,
                            reduce: hasAggregateFn && pQuery.args.select ? pQuery.args.select : undefined
                        }
                    })
                }

                if (pQuery.distinct) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.distinct,
                        name: "Distinct",
                        args: pQuery.distinct
                    })
                }

                if (pQuery.args.select && pQuery.args.select.length) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.functions,
                        name: "Functions & AS",
                        args: pQuery.args.select ? pQuery.args.select : undefined
                    })
                }

                if (pQuery.orderBy && !queryProcess.alreadyOrderBy) {
                    queryProcess.actions.push({
                        do: InanoSQLActions.order,
                        name: "Order By",
                        args: pQuery.orderBy
                    })
                }
            }

            if (pQuery.having) {
                if (pQuery.having.type === "arr") {
                    queryProcess.actions.push({
                        do: InanoSQLActions.filter_arr,
                        name: "Filter With Array",
                        args: pQuery.having.arr
                    })
                } else {
                    queryProcess.actions.push({
                        do: InanoSQLActions.filter_fn,
                        name: "Filter with Function",
                        args: pQuery.having.eval
                    })
                }
            }

            if (pQuery.range && pQuery.range.length && !queryProcess.alreadyRange) {
                queryProcess.actions.push({
                    do: InanoSQLActions.range,
                    name: "Offset / Limit",
                    args: pQuery.range
                });
            }
        }

        switch(pQuery.action) {
            case "select":
                // nothing to do, this is needed to prevent SELECT from doing default case
                break;
            case "total":
                queryProcess.actions.push({
                    do: InanoSQLActions.total,
                    name: "Total",
                    args: {
                        doRebuild: !!(pQuery.args.raw && pQuery.args.raw.rebuild),
                        table: pQuery.table.str
                    }
                });
                break;
            case "upsert":
                queryProcess.actions.push({
                    do: InanoSQLActions.upsert,
                    name: "Upsert",
                    args: Array.isArray(pQuery.args.raw) ? pQuery.args.raw : [pQuery.args.raw]
                });
                break;
            case "delete":
                queryProcess.actions.push({
                    do: InanoSQLActions.delete,
                    name: "Delete",
                    args: undefined
                });
                break;
            case "show tables":
                queryProcess.actions.push({
                    do: InanoSQLActions.show_tables,
                    name: "Show Tables",
                    args: undefined
                });
                break;
            case "describe":
                queryProcess.actions.push({
                    do: InanoSQLActions.describe,
                    name: "Describe Tables",
                    args: false
                });
                break;
            case "describe indexes":
                queryProcess.actions.push({
                    do: InanoSQLActions.describe,
                    name: "Describe Indexes",
                    args: true
                });
                break;
            case "drop":
            case "drop table":
                queryProcess.actions.push({
                    do: InanoSQLActions.drop_table,
                    name: "Drop Table",
                    args: pQuery.table.str
                });
                break;
            case "create table":
            case "create table if not exists":
                queryProcess.actions.push({
                    do: InanoSQLActions.create_table,
                    name: "Create Table",
                    args: pQuery.args.raw
                });
                break;
            case "alter table":
                queryProcess.actions.push({
                    do: InanoSQLActions.alter_table,
                    name: "Alter Table",
                    args: {
                        table: pQuery.table.str,
                        config: pQuery.args.raw
                    }
                });
                break;
            case "rebuild indexes":
                queryProcess.actions.push({
                    name: "Rebuild Indexes",
                    do: InanoSQLActions.rebuild_indexes,
                    args: undefined
                });
                break;
            case "conform rows":
                queryProcess.actions.push({
                    name: "Conform Rows",
                    do: InanoSQLActions.conform,
                    args: pQuery.args.raw
                });
                break;
            case "clone":
                queryProcess.actions.push({
                    do: InanoSQLActions.clone,
                    name: "Clone",
                    args: pQuery.args.raw
                });
                break;
            default:
                // custom query
                queryProcess.actions.push({
                    do: InanoSQLActions.custom_query,
                    name: "Custom Query",
                    args: pQuery.args.raw
                })
        }

        return queryProcess.actions;
    }

    /**
     * Resolves SELECT query into optimized table select actions.
     * Handles optimized query path detection.
     *
     * @param nSQL
     * @param pQuery
     */
    static resolveSelectActions(nSQL: InanoSQLInstance, pQuery: InanoSQLQueryAST): {actions: InanoSQLQueryActions[], alreadyOrderBy: boolean, alreadyRange: boolean} {

        if ([pQuery.table.str, pQuery.table.fn, pQuery.table.query].filter(f => f).length > 1) {
            throw new Error("nSQL: Can't select more than one table at a time!");
        }

        if(pQuery.table.arr || pQuery.table.fn) { // async tables or array tables

            const actions: InanoSQLQueryActions[] = [];

            if (pQuery.table.arr) {
                actions.push({
                    do: InanoSQLActions.select_arr,
                    name: "Select From Array",
                    args: {table: pQuery.table.arr, as: pQuery.table.as || ""}
                });
            } else {
                actions.push({
                    do: InanoSQLActions.select_fn,
                    name: "Select From Function",
                    args: {table: pQuery.table.fn, as: pQuery.table.as || ""}
                });
            }

            if (pQuery.where) {
                if (pQuery.where.type === "arr") {
                    actions.push({
                        do: InanoSQLActions.filter_arr,
                        name: "Filter With Array",
                        args: pQuery.where.arr
                    })
                } else {
                    actions.push({
                        do: InanoSQLActions.filter_fn,
                        name: "Filter With Function",
                        args: pQuery.where.eval
                    })
                }
            }
            
            return {
                actions: actions,
                alreadyOrderBy: false,
                alreadyRange: false
            };

        } else if (pQuery.table.query) { // external database reference

            const actions: InanoSQLQueryActions[] = [];

            actions.push({
                do: InanoSQLActions.select_external,
                name: "Select From External Source",
                args: {
                    as: pQuery.table.as || "",
                    query: pQuery.table.query,
                    queryArgs: new QueryArguments(
                        pQuery.table.as || "",
                        pQuery.originalWhere,
                        pQuery.range ? pQuery.range[0] : undefined,
                        pQuery.range ? pQuery.range[0] - pQuery.range[1] : undefined,
                        pQuery.orderBy ? pQuery.orderBy.map(v => `${v.value} ${v.dir}`) : undefined
                    )
                }
            });
            
            return {
                actions: actions,
                alreadyRange: true,
                alreadyOrderBy: true
            }

        } else { // local database

            const actions: InanoSQLQueryActions[] = [];



            const fullTableScan = (didSort?: boolean, reverse?: boolean, range?: [number, number]) => {
                actions.push({
                    do: InanoSQLActions.select_pk,
                    name: "Select By Primary Key",
                    args: {
                        table: pQuery.table.str,
                        as: pQuery.table.as || "",
                        reverse: reverse,
                        range: range
                    }
                });

                if (pQuery.where) {
                    if (pQuery.where.type === "arr") {
                        actions.push({
                            do: InanoSQLActions.filter_arr,
                            name: "Filter By Array",
                            args: pQuery.where.arr
                        })
                    } else {
                        actions.push({
                            do: InanoSQLActions.filter_fn,
                            name: "Filter By Function",
                            args: pQuery.where.eval
                        })
                    }
                }

                return {actions: actions, alreadyOrderBy: didSort || false, alreadyRange: range ? true : false};
            }


            // check if we have a WHERE statement, possibly optimize the WHERE query
            if (pQuery.where) {



                if (pQuery.where.type === "fn") { // function WHERE, full table scan (nothing to optimize)

                    return fullTableScan();

                } else { // array where, need to figure out fastest select method

                    const whereStatements = pQuery.where.arr as InanoSQLWhereQuery;

                    let whereIndexes: InanoSQLWhereIndex[] = [];

                    if (whereStatements.STMT) { // single where
                        whereIndexes = [this.findWhereIndexes(whereStatements.STMT, nSQL, pQuery)];
                    } else if(whereStatements.NESTED) { // compound where
                        whereStatements.NESTED.forEach((val, i) => {
                            if (val.STMT) {
                                whereIndexes.push(this.findWhereIndexes(val.STMT, nSQL, pQuery));
                            } else if (val.NESTED) { // further nested array WHERE will not be checked for optimized query path
                                whereIndexes.push({type: "query", value: [], where: val});
                            } else if (val.ANDOR) {
                                whereIndexes.push({type: "andor", value: [val.ANDOR]});
                            }
                        });
                    }

                    if (whereIndexes.length === 0) {
                        console.error(whereStatements);
                        throw new Error("nSQL: Error parsing where statement!");
                    }

                    // if the first WHERE isn't an index/primary key we do full table scan
                    if (["pk", "idx"].indexOf(whereIndexes[0].type) === -1) {
                        return fullTableScan();
                    }

                    let didOrderBy = false;

                    if (whereIndexes.length === 1) { // single where statement

                        const pkAction: InanoSQLQueryActions = {
                            do: whereIndexes[0].type === "pk" ? InanoSQLActions.select_pk : InanoSQLActions.select_index,
                            name:  whereIndexes[0].type === "pk" ? "Select by Primary Key" : "Select by Index",
                            args: {
                                where: whereIndexes[0].where ? whereIndexes[0].where.STMT : undefined,
                                index: whereIndexes[0].index
                            }
                        };

                        if (pQuery.orderBy && pQuery.orderBy.length === 1) {
                            if (typeof pQuery.orderBy[0].value === "string") {
                                const col = resolvePath(pQuery.orderBy[0].value);
                                if (objectsEqual(col, whereIndexes[0].value)) {
                                    didOrderBy = true;
                                    if (pQuery.orderBy[0].dir === "desc") {
                                        pkAction.args.reverse = true;
                                    }
                                }
                            }
                        } else if (!pQuery.orderBy) {
                            didOrderBy = true;
                        }


                        return {
                            actions: [pkAction],
                            alreadyRange: false,
                            alreadyOrderBy: didOrderBy
                        };

                    } else { // compound where statement

                        // combiner following primary key / index where MUST be "AND"
                        // if not, full table scan
                        if (whereIndexes[1] && whereIndexes[1].value && whereIndexes[1].value[0] !== "AND") {
                            return fullTableScan();
                        }

                        const compoundAction: InanoSQLQueryActions = {do: InanoSQLActions.select_compound, name: "Select by Compound Index / Primary Key Queries", args: {as: pQuery.table.as || "", table: pQuery.table.str, where: []}};
                        const slowAction: InanoSQLWhereQuery[] = [];
                        let isSlow = false;

                        whereIndexes.forEach((whereIndex, i) => {
                            const nextValue: InanoSQLWhereIndex = whereIndexes[i + 1] || {type: "andor", value: ["AND"]};

                            if (i % 2 === 1) {
                                // AND / OR
                                if (isSlow) {
                                    slowAction.push({ANDOR: whereIndex.value[0] as any});
                                } else if (whereIndex.value[0]) {
                                    compoundAction.args.where.push(whereIndex.value[0]);
                                }

                            } else if (isSlow) {
                                slowAction.push(whereIndex.where as any);
                            } else if (["pk", "idx"].indexOf(whereIndex.type) !== -1 && nextValue.value[0] === "AND") {
                                const pkAction: InanoSQLQueryActions = {
                                    do: whereIndex.type === "pk" ? InanoSQLActions.select_pk : InanoSQLActions.select_index,
                                    name:  whereIndexes[0].type === "pk" ? "Select by Primary Key" : "Select by Index",
                                    args: {
                                        where: whereIndex.where ? whereIndex.where.STMT : undefined,
                                        index: whereIndex.index
                                    }
                                };
                                if (i === 0) {
                                    if (pQuery.orderBy && pQuery.orderBy.length === 1) {
                                        if (typeof pQuery.orderBy[0].value === "string") {
                                            const col = resolvePath(pQuery.orderBy[0].value);
                                            if (objectsEqual(col, whereIndex.value)) {
                                                didOrderBy = true;
                                                if (pQuery.orderBy[0].dir === "desc") {
                                                    pkAction.args.reverse = true;
                                                }
                                            }
                                        }
                                    } else if (!pQuery.orderBy) {
                                        didOrderBy = true;
                                    }
                                }
                                compoundAction.args.where.push(pkAction);
                            } else {
                                isSlow = true;
                                slowAction.push(whereIndex.where as any);
                            }
                        });
                        return {
                            actions: slowAction.length ? [compoundAction, {do: InanoSQLActions.filter_arr, name: "Filter By Array", args: {NESTED: slowAction}}] : [compoundAction],
                            alreadyRange: false,
                            alreadyOrderBy: didOrderBy
                        };
                    }
                }
            } else {
                try {
                    // no WHERE statement
                    const tableData = pQuery.db ? pQuery.db._tables[pQuery.db._tableIds[pQuery.table.str || ""]] : undefined;

                    const selectActions: InanoSQLQueryActions[] = [];

                    let didOrderBy = false;
                    let didRange = false;

                    if (tableData) {
                        if (pQuery.orderBy && pQuery.orderBy.length === 1) {
                            if (typeof pQuery.orderBy[0].value === "string") {
                                const col = resolvePath(pQuery.orderBy[0].value);
                                if (objectsEqual(col, tableData.pkCol)) { // possibly order by primary key
                                    didOrderBy = true;
                                    if (pQuery.orderBy[0].dir === "desc") {
                                        selectActions.push({
                                            do: InanoSQLActions.select_pk,
                                            name: "Select by Primary Key",
                                            args: {reverse: true}
                                        })
                                    } else {
                                        selectActions.push({
                                            do: InanoSQLActions.select_pk,
                                            name: "Select by Primary Key",
                                            args: {}
                                        })
                                    }
                                } else { // possibly order by index
                                    Object.keys(tableData.indexes).forEach((key) => {
                                        if (selectActions.length) return;

                                        const index = tableData.indexes[key];
                                        if (objectsEqual(col, index.path)) { // order by primary key
                                            didOrderBy = true;
                                            if ((pQuery.orderBy as any)[0].dir === "desc") {
                                                selectActions.push({
                                                    do: InanoSQLActions.select_index,
                                                    name: "Select by Index",
                                                    args: {reverse: true, index: index}
                                                })
                                            } else {
                                                selectActions.push({
                                                    do: InanoSQLActions.select_index,
                                                    name: "Select by Index",
                                                    args: {index: index}
                                                })
                                            }
                                        }
                                    })
                                }
                            }
                        } else if (!pQuery.orderBy) {
                            // no order by
                            selectActions.push({
                                do: InanoSQLActions.select_pk,
                                name: "Select by Primary Key",
                                args: {}
                            })
                            didOrderBy = true;
                        } else {
                            // arbitrary order by
                            selectActions.push({
                                do: InanoSQLActions.select_pk,
                                name: "Select by Primary Key",
                                args: {}
                            })
                        }

                        // can only do optimized offest / limit on primary key selects with simple or no order by
                        if (didOrderBy && pQuery.range && selectActions[0].do === InanoSQLActions.select_pk) {
                            didRange = true;
                            selectActions[0].args.range = pQuery.range;
                        }

                        return {
                            actions: selectActions.length ? selectActions : [{
                                do: InanoSQLActions.select_pk,
                                name: "Select by Primary Key",
                                args: {}
                            }],
                            alreadyOrderBy: didOrderBy,
                            alreadyRange: didRange
                        }
                    }

                } catch(e) {
                    throw new Error(e);
                }


            }

            return {actions: [], alreadyOrderBy: false, alreadyRange: false};
        }
    }

    /**
     * Discovers if the specific WHERE query can select against an index or primary key
     *
     * @param where
     * @param nSQL
     * @param pQuery
     */
    static findWhereIndexes(where: InanoSQLWhereStatement, nSQL: InanoSQLInstance, pQuery: InanoSQLQueryAST): InanoSQLWhereIndex {

        // if there is no database selected, then no query optizations are possible.
        if (!pQuery.db || pQuery.table !== "string") return {type: "query", value: [], where: {STMT: where}};

        const tableId = (pQuery.db as InanoSQLDBConfig)._tableIds[pQuery.table as string];
        const tableCnfg = (pQuery.db as InanoSQLDBConfig)._tables[tableId];

        const supportedMatches = ["LIKE", "BETWEEN", "=", "IN"];
        const supportedMatchesArr = ["INCLUDES", "INCLUDES LIKE", "INCLUDES BETWEEN", "INTERSECT", "INTERSECT ALL"];

        if (typeof where[0] === "string") {

            const objectPath = resolvePath(where[0]);
            const objectMatchType = where[1];

            if (objectsEqual(objectPath, tableCnfg.pkCol) && supportedMatches.indexOf(objectMatchType) !== -1) {
                return {type: "pk", value: objectPath, where: {STMT: where}};
            }

            const index = Object.keys(tableCnfg.indexes).reduce((prev, index) => {
                const idx = tableCnfg.indexes[index];
                if (objectsEqual(objectPath, idx.path)) {
                    if (idx.isArray) {
                        if (supportedMatchesArr.indexOf(objectMatchType) !== -1) {
                            return {type: "idx", value: objectPath, index: idx,  where: {STMT: where}};
                        }
                    } else {
                        if (supportedMatches.indexOf(objectMatchType) !== -1) {
                            return {type: "idx", value: objectPath, index: idx, where: {STMT: where}};
                        }
                    }
                }
                return prev;
            }, undefined);

            if (index) return (index as any);
        } else {
            // where statement with function on left side isn't supported for indexing
            // TODO: evaluate arguments/functions recursively to discover if we can resolve to index or primary key
            return {type: "query", value: [], where: {STMT: where}};
        }

        return {type: "query", value: [], where: {STMT: where}};
    }


    static hasAggrFn(nSQL: InanoSQLInstance, pQuery: InanoSQLQueryAST): boolean {
        if (pQuery.args.select && pQuery.args.select.length) {

            // only checks top level of SELECT arguments
            let hasAggr = false;

            let i = 0;
            while(i < pQuery.args.select.length && hasAggr === false) {
                const selectArg = pQuery.args.select[i];
                if (typeof selectArg.value !== "string") { // function in SELECT
                    const fnName = selectArg.value.name;
                    const fnOpts = nSQL.functions[fnName];
                    if (!fnOpts) {
                        throw new Error(`Function ${fnName} not found!`);
                    }
                    if (fnOpts.type === "A") {
                        hasAggr = true;
                    }
                }
                i++;
            }

            return hasAggr;


        } else {
            return false;
        }
    }

}